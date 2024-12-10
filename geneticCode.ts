import seedrandom from "seedrandom";
import {
  GeneticConfig,
  GeneticConfigTweakables,
  MeasuredCandidate,
} from "./genetic.js";
import { clone, defaulted, saturate, shuffle } from "./util.js";
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
  uniqueTestResults: number;
  passedTests: number;
  totalRunSeconds: number;
}

export interface CodeError {
  line: number;
  message: string;
}

// TODO(trevor): Right now we're only modeling simple programs with stdin/stdout, but eventually this should
// effectively be a virtual environment where we can give it many types of inputs
// It will be up to the adapters to decide what it means for each source and target language
// That said, the user is always welcome to do anything they want with these inputs (put json in a string, parse it, etc)
export type CodeRuntimeInput = string;
export type CodeRuntimeOutput = string;

export type LLMOptions = Omit<Omit<llm.LLamaChatPromptOptions, "onTextChunk">, "seed">;
export type LLMPrompt = (promptStr: string, options?: LLMOptions) => Promise<string> | string;

export interface CodeTestCompare {
  expected: CodeRuntimeOutput;
  output: CodeRuntimeOutput;
};

export interface CodeTestCompareRating {
  // A number between [0, 1]
  rating: number;

  // A description as to what was different between the expected and the output
  explanation: string;
};

export type CodeTestResult = CodeTestCompare & CodeTestCompareRating & {
  input: string
};

export interface CodeGeneticConfig extends GeneticConfigTweakables {
  llmModelPath: string;

  // Default is 3
  llmIterations?: number;

  // The inputs that we wish to test the code with
  // We use these with both runSample (to get the expected output) and runCompiled (to test our generated code)
  testInputs: CodeRuntimeInput[];

  // Run the sample that we wish to mimic it's input and output
  // Note that if
  runSample: (
    input: CodeRuntimeInput
  ) => Promise<CodeRuntimeOutput> | CodeRuntimeOutput;

  // Compile the code candidate, and output any compile errors
  compile: (code: CodeCandidate) => Promise<string> | string; // TODO(trevor): CodeError[]

  // Run the compiled code and retrieve it's output (or any runtime errors)
  runCompiled: (
    code: CodeCandidate,
    input: CodeRuntimeInput
  ) => Promise<CodeRuntimeOutput> | CodeRuntimeOutput;

  // Test the performance of the compiled code (run a performance test)
  // Note that if this routine returns a number in seconds, we will use that as our performance number
  // Otherwise we will wrap this call with our own performance time sampling
  testPerformance: (
    code: CodeCandidate
  ) => Promise<number | void> | number | void;

  promptRandomCandidate(prompt: LLMPrompt): Promise<CodeSource> | CodeSource;

  promptFixCompileErrors(candidate: CodeCandidate, errors: string, prompt: LLMPrompt): Promise<CodeSource> | CodeSource;

  promptRating(candidate: CodeCandidate, comparison: CodeTestCompare, prompt: LLMPrompt): Promise<CodeTestCompareRating> | CodeTestCompareRating;

  promptFixTestErrors(candidate: CodeCandidate, results: CodeTestResult[], prompt: LLMPrompt): Promise<CodeSource> | CodeSource;

  promptCrossoverBreedFixup(combined: CodeSource, prompt: LLMPrompt): Promise<CodeSource> | CodeSource;

  promptMutationFixup(mutated: CodeSource, prompt: LLMPrompt): Promise<CodeSource> | CodeSource;
}

const cosineSimilarity = (vecA: Float32Array, vecB: Float32Array): number => {
  const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
  const result = dotProduct / (magnitudeA * magnitudeB);
  return saturate(result);
};

const getEmbedding = async (
  sentence: string,
  featureExtractor: transformers.FeatureExtractionPipeline
): Promise<Float32Array> => {
  const embedding = await featureExtractor(sentence, {
    pooling: "mean",
    normalize: true,
  });
  return embedding.data as Float32Array;
};

let llamaPromise: Promise<llm.Llama> | undefined = undefined;
export const getLlama = () => {
  if (llamaPromise) {
    return llamaPromise;
  }
  llamaPromise = llm.getLlama({
    logLevel: llm.LlamaLogLevel.disabled,
  });
  return llamaPromise;
};

interface TestResult {
  input: CodeRuntimeInput;
  output: CodeRuntimeOutput;
}

const addUniqueTestResult = (set: Set<string>, output: CodeRuntimeOutput) => {
  // Note we stringify output in case we change the representation of CodeRuntimeOutput
  set.add(JSON.stringify(output));
}

export const geneticCodeConfig = async (config: CodeGeneticConfig) => {
  const uniqueSampleTestOutputs = new Set<string>();
  const testSamples: TestResult[] = [];
  for (const testInput of config.testInputs) {
    const output = await config.runSample(testInput);
    testSamples.push({
      input: testInput,
      output
    });

    addUniqueTestResult(uniqueSampleTestOutputs, output);
  }

  const uniqueSampleTestOutputFraction = uniqueSampleTestOutputs.size / testSamples.length;
  console.log("uniqueSampleTestOutputFraction", uniqueSampleTestOutputFraction);

  const featureExtractor = await transformers.pipeline(
    "feature-extraction",
    path.join(process.cwd(), "./models/sentence-transformers_all-MiniLM-L6-v2")
  );

  const compareStrings = async (
    str1: string,
    str2: string
  ): Promise<number> => {
    const embedding1 = await getEmbedding(str1, featureExtractor);
    const embedding2 = await getEmbedding(str2, featureExtractor);
    return cosineSimilarity(embedding1, embedding2);
  };

  const llama = await getLlama();
  const model = await llama.loadModel({
    modelPath: config.llmModelPath,
  });

  let prompting = false;
  const promptCallback = async (seed: number, promptStr: string, options?: LLMOptions): Promise<string> => {
    if (prompting) {
      throw new Error("CANNOT PROMPT TWICE");
    }
    prompting = true;
    const context = await model.createContext();
    const session = new llm.LlamaChatSession({
      contextSequence: context.getSequence(),
    });

    console.log("SEED:", seed, "PROMPT:", promptStr);
    const result = await session.prompt(promptStr, {
      ...options as llm.LLamaChatPromptOptions,
      seed,
      onTextChunk(text) {
        process.stdout.write(text);
      },
    });
    process.stdout.write("\n");
    await session.dispose();
    await context.dispose();
    prompting = false;
    return result;
  };

  const compareFitness = (a: CodeFitness, b: CodeFitness): number => {
    if (b.compileErrors !== a.compileErrors) {
      // Sort compile errors descending (larger amount of errors is worse)
      return b.compileErrors - a.compileErrors;
    }

    if (b.uniqueTestResults !== a.uniqueTestResults) {
      // Sort unique test results ascending (larger amount up to the uniqueTestOutputFraction is better)
      return a.uniqueTestResults - b.uniqueTestResults;
    }

    if (b.passedTests !== a.passedTests) {
      // Sort passed tests ascending (larger amount of passed tests is better)
      // Note that passedTests is not an integer (can be a float value)
      return a.passedTests - b.passedTests;
    }

    // Sort performance descending (larger performance time is worse)
    return b.totalRunSeconds - a.totalRunSeconds;
  };

  // TODO(trevor): Actually verify this is unqiue, need to pass down the population
  // Note that the llama.cpp takes only positive integers (not decimals)
  const newUniqueSeed = (random: seedrandom.PRNG) => Math.abs(random.int32());

  const geneticConfig: GeneticConfig<CodeCandidate, CodeFitness> = {
    ...config,

    async randomCandidate(random) {
      const uniqueSeed = newUniqueSeed(random);
      return {
        uniqueSeed,
        source: await config.promptRandomCandidate((promptStr, options) =>
          promptCallback(uniqueSeed, promptStr, options)),
      };
    },

    async simulateAndMeasureFitness(
      candidate,
      random
    ): Promise<MeasuredCandidate<CodeCandidate, CodeFitness>> {
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
        const currentCandidate = newCandidate;
        newCandidate = clone(newCandidate);
        const compileErrors = await config.compile(currentCandidate);

        const fitness: CodeFitness = {
          compileErrors: compileErrors.length,
          uniqueTestResults: 0,
          passedTests: 0,
          totalRunSeconds: 0,
        };
        if (compileErrors) {
          newCandidate.source = await config.promptFixCompileErrors(currentCandidate, compileErrors, (promptStr, options) =>
            promptCallback(currentCandidate.uniqueSeed, promptStr, options));
        } else {
          // Shuffle the inputs so that the LLM won't get stuck on specific inputs
          const testSamplesShuffled = shuffle([...testSamples], random);
          let failedAnyTest = false;
          const uniqueCompiledTestOutputs = new Set<string>();
          const testResults: CodeTestResult[] = [];
          for (const testSample of testSamplesShuffled) {
            const sampleResult = testSample.output;
            const compiledResult = await config.runCompiled(
              currentCandidate,
              testSample.input
            );

            addUniqueTestResult(uniqueCompiledTestOutputs, compiledResult);

            if (sampleResult === compiledResult) {
              ++fitness.passedTests;
            } else {
              failedAnyTest = true;

              // Asking the LLM for a comparison is great because it can do slightly more in depth analysis
              // and discover similar patterns between them (meaning the translation can be on the right track)
              // However the LLM can tend to occasionally hallucinate, so we also use sentence similarity
              const comparison = {
                expected: sampleResult,
                output: compiledResult,
              };
              const ratingResult = await config.promptRating(currentCandidate, comparison, (promptStr, options) =>
                promptCallback(currentCandidate.uniqueSeed, promptStr, options));
              testResults.push({
                ...comparison,
                ...ratingResult,
                input: testSample.input
              });

              // Sentence similarity to compare the outputs
              // This also works really well for comparing the meanings of outputs
              // However we observed that inputs such as "1" and "1, 2, 3, 4, 5" will result in a high match
              // Because of this, we also do the length comparison below
              const similarity = await compareStrings(
                sampleResult,
                compiledResult
              );

              // Results in a value between [0, 1]
              // We always take the length of the smaller string divided by the length of the larger
              // to see how far off the true length we are (1 means they are the same)
              const lengthResult =
                sampleResult.length < compiledResult.length
                  ? sampleResult.length / compiledResult.length
                  : compiledResult.length / sampleResult.length;
              const lengthCompare = isFinite(lengthResult) ? lengthResult : 0.0;

              // We don't ever allow the combined to be 1, as it should never be exactly the same as a passed test
              const combined = Math.min(
                (ratingResult.rating + similarity + lengthCompare) / 3,
                0.999999
              );
              console.log(
                "rating",
                ratingResult,
                "similarity",
                similarity,
                "lengthCompare",
                lengthCompare,
                "combined",
                combined
              );
              fitness.passedTests += combined;
            }
          }

          // We want to see how many of the tests resulted in a unique output
          // This is because it's common to have programs that crash, time out, or always output the same thing ignoring inputs
          // We want to penalize these programs over running working programs that produce varied outputs
          const uniqueCompiledTestOutputFraction = uniqueCompiledTestOutputs.size / testSamplesShuffled.length;
          console.log("uniqueCompiledTestOutputFraction", uniqueCompiledTestOutputFraction);
          fitness.uniqueTestResults = saturate(uniqueCompiledTestOutputFraction / uniqueSampleTestOutputFraction);
          console.log("uniqueTestResults", fitness.uniqueTestResults);

          if (failedAnyTest) {
            newCandidate.source = await config.promptFixTestErrors(currentCandidate, testResults, (promptStr, options) =>
              promptCallback(currentCandidate.uniqueSeed, promptStr, options));
          } else {
            const startMs = performance.now();
            const perfResult = await config.testPerformance(currentCandidate);
            const endMs = performance.now();
            fitness.totalRunSeconds =
              typeof perfResult === "number"
                ? perfResult
                : (endMs - startMs) / 1000;
          }
        }

        console.log("FITNESS:", JSON.stringify(fitness, null, 2));
        allAttempts.push({ candidate: currentCandidate, fitness });
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

      const newlineRegex = /\r?\n/;
      const aLines = a.source.split(newlineRegex);
      const bLines = b.source.split(newlineRegex);

      // Ensure we have at least one line in each to ensure we run at least one iteration below
      if (aLines.length == 0) {
        aLines.push("");
      }
      if (bLines.length == 0) {
        bLines.push("");
      }

      // Combine lines from A and B
      // If one is longer than the other, prefer to choose lines from the longer one more often
      const combinedLines: string[] = [];
      let aIndex = 0;
      let bIndex = 0;
      const totalLength = aLines.length + bLines.length;
      const aProbability = aLines.length / totalLength;
      while (aIndex < aLines.length && bIndex < bLines.length) {
        const addLine = random() < 0.5;
        if (random() < aProbability) {
          if (addLine) {
            combinedLines.push(aLines[aIndex]);
          }
          ++aIndex;
        } else {
          if (addLine) {
            combinedLines.push(bLines[bIndex]);
          }
          ++bIndex;
        }
      }

      const combined = combinedLines.join("\n");

      const source = await config.promptCrossoverBreedFixup(combined, (promptStr, options) =>
        promptCallback(uniqueSeed, promptStr, options));
      return {
        uniqueSeed,
        source,
      };
    },

    // For mutation for now we just go through character by character
    async mutate(candidate, mutationRate, random) {
      let mutatedSource = "";

      for (let i = 0; i < candidate.source.length; ++i) {
        if (random() < mutationRate) {
          const ASCII_PRINTABLE_START = 32;
          const ASCII_PRINTABLE_END = 126;
          mutatedSource += String.fromCharCode(
            ASCII_PRINTABLE_START +
              (Math.abs(random.int32()) %
                (ASCII_PRINTABLE_END - ASCII_PRINTABLE_START))
          );
        } else {
          mutatedSource += candidate.source[i];
        }
      }
      console.log("MUTATED FROM:");
      console.log(candidate.source);
      console.log("MUTATED TO:");
      console.log(mutatedSource);

      const source = await config.promptMutationFixup(mutatedSource, (promptStr, options) =>
        promptCallback(candidate.uniqueSeed, promptStr, options));

      return {
        uniqueSeed: candidate.uniqueSeed,
        source,
      };
    },
  };

  return geneticConfig;
};
