import seedrandom from "seedrandom";
import { GeneticConfig, GeneticConfigTweakables, MeasuredCandidate } from "./genetic";
import { clone, defaulted, shuffle } from "./util";

// TODO(trevor): Eventually this should become a virtual fileystem with multiple files
export type CodeSource = string;
export interface CodeCandidate {
  source: CodeSource;
  uniqueSeed: number;
}

export interface CodeFitness {
  compileErrors: number;
  failedTests: number;
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
  // Default is 3
  llmIterations?: number;

  language: string;

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

  prompt: (seed: number, prompt: string) => Promise<string> | string;
}

export const geneticCodeConfig = async (config: CodeGeneticConfig) => {
  const sourceHeader = `Original Source:\n===\n${config.sourceOrInstructions}\n---\n`;
  const footer = `Strictly output ONLY safe ${config.language}, no surrounding explanations, no examples, no hardcoded test-inputs, nothing else:`;

  const compareFitness = (a: CodeFitness, b: CodeFitness): number => {
    if (b.compileErrors !== a.compileErrors) {
      // Sort compile errors descending (larger amount of errors is worse)
      return b.compileErrors - a.compileErrors;
    }

    if (b.failedTests !== a.failedTests) {
      // Sort failed tests descending (larger amount of failed tests is worse)
      return b.failedTests - a.failedTests;
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
        source: await config.prompt(uniqueSeed, `${sourceHeader}Translate this. ${footer}`),
      };
    },

    async simulateAndMeasureFitness(candidate): Promise<MeasuredCandidate<CodeCandidate, CodeFitness>> {
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
          failedTests: 0,
          totalRunSeconds: 0,
        };
        if (compileErrors) {
          newCandidate.source = await config.prompt(newCandidate.uniqueSeed, `${sourceHeader}Last Translation:\n===\n${newCandidate.source}\n---\nFix Issues:\n===\n${compileErrors}\n---\n${footer}`);
        } else {
          let prompt = `${sourceHeader}Last Translation:\n===\n${newCandidate.source}\n---\n`;
          // Shuffle the inputs so that the LLM won't get stuck on specific inputs
          const testInputsShuffled = shuffle([...config.testInputs], seedrandom(`${candidate.uniqueSeed}`));
          for (const testInput of testInputsShuffled) {
            const sampleResult = await config.runSample(testInput);
            const compiledResult = await config.runCompiled(newCandidate, testInput);
            if (sampleResult !== compiledResult) {
              ++fitness.failedTests;
              prompt += `Test Stdin:\n===\n${testInput}\n---\nErroneous Stdout:\n===\n${compiledResult}\n---\nExpected Stdout:\n===\n${sampleResult}\n---\n`;
            }
          }

          if (fitness.failedTests) {
            prompt += `Fix Issues. ${footer}`;
            newCandidate.source = await config.prompt(newCandidate.uniqueSeed, prompt);
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
      const source = await config.prompt(uniqueSeed,
        `${sourceHeader}Translation A:\n===\n${a.source}\n---\nTranslation B:\n===\n${b.source}\n---\nCombine translation A and B using half from each. MUST use lines from both. ${footer}`);
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
