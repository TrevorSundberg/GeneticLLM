import seedrandom from "seedrandom";
import { GeneticConfig, GeneticConfigTweakables, MeasuredCandidate } from "./genetic.js";
import { clone, defaulted, shuffle } from "./util.js";
import * as llm from "node-llama-cpp";
import * as transformers from "@huggingface/transformers";
import path from "node:path";

transformers.env.allowLocalModels = true;
transformers.env.allowRemoteModels = false;
transformers.env.localModelPath = "";

// TODO(trevor): Eventually this should become a virtual fileystem with multiple files
export type CodeSource = string;
export interface CodeCandidate {
  source: CodeSource;
  uniqueSeed: number;
}

export interface CodeFitness {
  compileErrors: number;
  passedTests: number;
  totalRunSeconds: number;
}

export interface CodeError {
  line: number;
  message: string;
};

// TODO(trevor): Right now we're only modeling simple programs with stdin/stdout, but eventually this should
// effectively be a virtual environment where we can give it many types of inputs
// It will be up to the adapters to decide what it means for each source and target language
// That said, the user is always welcome to do anything they want with these inputs (put json in a string, parse it, etc)
export type CodeRuntimeInput = string;
export type CodeRuntimeOutput = string;

export interface CodeGeneticConfig extends GeneticConfigTweakables {
  llmModelPath: string;

  // Default is 3
  llmIterations?: number;
  
  languageDescription: string;

  languageGrammar?: string;

  sourceOrInstructions: CodeSource;

  // The inputs that we wish to test the code with
  // We use these with both runSample (to get the expected output) and runCompiled (to test our generated code)
  testInputs: CodeRuntimeInput[];

  // Run the sample that we wish to mimic it's input and output
  // Note that if 
  runSample: (input: CodeRuntimeInput) => Promise<CodeRuntimeOutput> | CodeRuntimeOutput;

  // Compile the code candidate, and output any compile errors
  compile: (code: CodeCandidate) => Promise<string> | string; // TODO(trevor): CodeError[]

  // Run the compiled code and retrieve it's output (or any runtime errors)
  runCompiled: (code: CodeCandidate, input: CodeRuntimeInput) => Promise<CodeRuntimeOutput> | CodeRuntimeOutput;

  // Test the performance of the compiled code (run a performance test)
  // Note that if this routine returns a number in seconds, we will use that as our performance number
  // Otherwise we will wrap this call with our own performance time sampling
  testPerformance: (code: CodeCandidate) => Promise<number | void> | number | void;
}

const cosineSimilarity = (vecA: Float32Array, vecB: Float32Array): number => {
  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  const result = dotProduct / (magnitudeA * magnitudeB);
  if (isFinite(result)) {
    return Math.min(Math.max(result, 0), 1);
  }
  return 0;
}

const getEmbedding = async(
  sentence: string,
  featureExtractor: transformers.FeatureExtractionPipeline
): Promise<Float32Array> => {
  const embedding = await featureExtractor(sentence, {
    pooling: "mean",
    normalize: true,
  });
  return embedding.data as Float32Array;
}

export const geneticCodeConfig = async (config: CodeGeneticConfig) => {
  const sourceHeader = `Original Source:\n===\n${config.sourceOrInstructions}\n---\n`;
  const footer = `Strictly output ONLY safe ${config.languageDescription}, no surrounding explanations, no examples, no hard-coded test-inputs, nothing else:`;

  const featureExtractor = await transformers.pipeline(
    "feature-extraction",
    path.join(process.cwd(), "./models/sentence-transformers_all-MiniLM-L6-v2")
  );

  const compareStrings = async(
    str1: string,
    str2: string
  ): Promise<number> => {
    const embedding1 = await getEmbedding(str1, featureExtractor);
    const embedding2 = await getEmbedding(str2, featureExtractor);
    return cosineSimilarity(embedding1, embedding2);
  }

  const llama = await llm.getLlama({
    logLevel: llm.LlamaLogLevel.disabled,
  });
  const model = await llama.loadModel({
    modelPath: config.llmModelPath
  });
  const ratingGrammar = new llm.LlamaGrammar(llama, {
    grammar: 'root ::= ([1-9] [1-9]? | "100") "\nReason: " [^\n]+'
  });
  const languageGrammar = config.languageGrammar
    ? new llm.LlamaGrammar(llama, { grammar: config.languageGrammar })
    : undefined;

  let prompting = false;
  const prompt = async(seed: number, prompt: string, grammar: llm.LlamaGrammar | undefined) => {
    if (prompting) {
      throw new Error("CANNOT PROMPT TWICE");
    }
    prompting = true;
    const context = await model.createContext();
    const session = new llm.LlamaChatSession({
      contextSequence: context.getSequence(),
    });

    console.log("SEED:", seed, "PROMPT:", prompt);
    const result = await session.prompt(prompt, {
      temperature: 0.7,
      seed,
      grammar,
      onTextChunk(text) {
        process.stdout.write(text);
      },
    });
    process.stdout.write("\n");
    await session.dispose();
    await context.dispose();
    prompting = false;
    return result;
  }

  const compareFitness = (a: CodeFitness, b: CodeFitness): number => {
    if (b.compileErrors !== a.compileErrors) {
      // Sort compile errors descending (larger amount of errors is worse)
      return b.compileErrors - a.compileErrors;
    }

    if (b.passedTests !== a.passedTests) {
      // Sort passed tests ascending (larger amount of passed tests is better)
      // Note that passedTests is not an integer (can be a float value)
      return a.passedTests - b.passedTests;
    }

    // Sort performance descending (larger performance time is worse)
    return b.totalRunSeconds - a.totalRunSeconds;
  }

  // TODO(trevor): Actually verify this is unqiue, need to pass down the population
  // Note that the llama.cpp takes only positive integers (not decimals)
  const newUniqueSeed = (random: seedrandom.PRNG) => Math.abs(random.int32());

  const geneticConfig: GeneticConfig<CodeCandidate, CodeFitness> = {
    ...config,

    async randomCandidate(random) {
      const uniqueSeed = newUniqueSeed(random);
      return {
        uniqueSeed,
        source: await prompt(uniqueSeed, `${sourceHeader}Translate this. ${footer}`, languageGrammar),
      };
    },

    async simulateAndMeasureFitness(candidate, random): Promise<MeasuredCandidate<CodeCandidate, CodeFitness>> {
      console.log("BEGIN SIMULATE / MEASURE", candidate.uniqueSeed);
      const allAttempts: MeasuredCandidate<CodeCandidate, CodeFitness>[] = [];

      // TODO(trevor): Measure fitness individually for each llm attempt (building from the last)
      // the end result is going to be the attempt that reached the best fitness of all iterations
      // In a way, we could have a sort of similar issue here with selection
      // but I think the idea would be to actually do less iterations, as iterations get smaller choosing the best is not as selective
      // Should it be the best attempt, or just the end attempt?
      let newCandidate = candidate;
      const llmIterations = Math.max(defaulted(config.llmIterations, 3), 1);
      for (let attempt = 0; attempt < llmIterations; ++attempt) {
        newCandidate = clone(newCandidate);
        const compileErrors = await config.compile(newCandidate);

        const fitness: CodeFitness = {
          compileErrors: compileErrors.length,
          passedTests: 0,
          totalRunSeconds: 0,
        };
        if (compileErrors) {
          newCandidate.source = await prompt(newCandidate.uniqueSeed, `${sourceHeader}Last Translation:\n===\n${newCandidate.source}\n---\nFix Issues:\n===\n${compileErrors}\n---\n${footer}`, languageGrammar);
        } else {
          let promptText = `${sourceHeader}Last Translation:\n===\n${newCandidate.source}\n---\n`;
          // Shuffle the inputs so that the LLM won't get stuck on specific inputs
          const testInputsShuffled = shuffle([...config.testInputs], random);
          let failedAnyTest = false;
          for (const testInput of testInputsShuffled) {
            const sampleResult = await config.runSample(testInput);
            const compiledResult = await config.runCompiled(newCandidate, testInput);
            if (sampleResult === compiledResult) {
              ++fitness.passedTests;
            } else {
              failedAnyTest = true;
              
              // Asking the LLM for a comparison is great because it can do slightly more in depth analysis
              // and discover similar patterns between them (meaning the translation can be on the right track)
              // However the LLM can tend to occasionally hallucinate, so we also use sentence similarity
              const compare = { expected: sampleResult, output: compiledResult };
              const ratingResult = await prompt(
                newCandidate.uniqueSeed,
                `${JSON.stringify(compare, null, 2)}\nRate similarity of expected and output, 1 = no similarity, 100 = exact match, (1-100): `,
                ratingGrammar
              );
              const [ratingStr, ratingReason] = ratingResult.split("\n");
              const rating = parseInt(ratingStr) / 100;

              // Sentence similarity to compare the outputs
              // This also works really well for comparing the meanings of outputs
              // However we observed that inputs such as "1" and "1, 2, 3, 4, 5" will result in a high match
              // Because of this, we also do the length comparison below
              const similarity = await compareStrings(sampleResult, compiledResult);

              // Results in a value between [0, 1]
              // We always take the length of the smaller string divided by the length of the larger
              // to see how far off the true length we are (1 means they are the same)
              const lengthResult = sampleResult.length < compiledResult.length
                ? sampleResult.length / compiledResult.length
                : compiledResult.length / sampleResult.length;
              const lengthCompare = isFinite(lengthResult) ? lengthResult : 0.0;

              // We don't ever allow the combined to be 1, as it should never be exactly the same as a passed test
              const combined = Math.min((rating + similarity + lengthCompare) / 3, 0.999999);
              console.log("rating", rating, "similarity", similarity, "lengthCompare", lengthCompare, "combined", combined);
              fitness.passedTests += combined;
              
              promptText += `Erroneous Stdout:\n===\n${compiledResult}\n---\nExpected Stdout:\n===\n${sampleResult}\n---\n${ratingReason}\n###\n`;
            }
          }

          if (failedAnyTest) {
            promptText += `Fix Issues. ${footer}`;
            newCandidate.source = await prompt(newCandidate.uniqueSeed, promptText, languageGrammar);
          } else {
            const startMs = performance.now();
            const perfResult = await config.testPerformance(newCandidate);
            const endMs = performance.now();
            fitness.totalRunSeconds = typeof perfResult === "number"
              ? perfResult
              : (endMs - startMs) / 1000;
          }
        }

        console.log("FITNESS:", JSON.stringify(fitness, null, 2));
        allAttempts.push({ candidate: newCandidate, fitness });
       }

      // Sort fitness in ascending order for rank based selection
      allAttempts.sort((a, b) => compareFitness(a.fitness, b.fitness));

      // Pick the best fitness out of all LLM attempts
      // TODO(trevor): Investigate if we should do any other approaches here, like selection for diversity
      const best = allAttempts[allAttempts.length - 1];

      console.log("BEST:", JSON.stringify(best, null, 2));
      
      console.log("END", candidate.uniqueSeed);
      return best;
    },
  
    compareFitness,

    async crossoverBreed(a, b, random) {
      const uniqueSeed = newUniqueSeed(random);
      const source = await prompt(uniqueSeed,
        `${sourceHeader}Translation A:\n===\n${a.source}\n---\nTranslation B:\n===\n${b.source}\n---\nCombine lines half from A and half from B. MUST use 50% of lines from each. ${footer}`, languageGrammar);
      return {
        uniqueSeed,
        source
      };
    },

    // For mutation for now we just go through character by character
    mutate(candidate, mutationRate, random) {
      let source = '';

      for (let i = 0; i < candidate.source.length; ++i) {
        if (random() < mutationRate) {
          const ASCII_PRINTABLE_START = 32;
          const ASCII_PRINTABLE_END = 126;
          source += String.fromCharCode(ASCII_PRINTABLE_START +
            (Math.abs(random.int32()) % (ASCII_PRINTABLE_END - ASCII_PRINTABLE_START)));
        } else {
          source += candidate.source[i];
        }
      }
      console.log("MUTATED FROM:")
      console.log(candidate.source);
      console.log("MUTATED TO:")
      console.log(source);

      return {
        uniqueSeed: candidate.uniqueSeed,
        source
      };
    },
  };

  return geneticConfig;
};
