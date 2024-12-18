import fs from "node:fs";
import { geneticPass } from "./genetic.js";
import { CodeCandidate, geneticCodeConfig, getLlama } from "./geneticCode.js";
import { execFileSync } from "node:child_process";

/*
(async() => {
const NUMBER_COUNT = 15;
const TARGET = 123;
let population: number[][] = [];
const config: GeneticConfig<number[], number> = {
  randomCandidate(random) {
    const result: number[] = [];
    for (let i = 0; i < NUMBER_COUNT; ++i) {
      result.push(random.int32() % 100);
    }
    return result;
  },
  simulateAndMeasureFitness: (candidate) => ({
    candidate,
    fitness: -Math.abs(candidate.reduce((accumulator, currentValue) => accumulator + currentValue, 0) - TARGET)
  }),
  compareFitness(a, b) {
    return a - b;
  },
  crossoverBreed(a, b, random) {
    const result: number[] = [];
    for (let i = 0; i < NUMBER_COUNT; ++i) {
      result.push(random() < 0.5 ? a[i] : b[i]);
    }
    return result;
  },
  mutate(candidate, mutationRate, random) {
    const result = [...candidate];
    for (let i = 0; i < NUMBER_COUNT; ++i) {
      if (random() < mutationRate) {
        result[i] = random.int32() % 100;
      }
    }
    return result;
  },
};
for (let i = 0; i < 1000; ++i) {
  const measured = await geneticPass(config, population);
  console.log(measured.map(pair => ({candidate: pair.candidate.join(" + "), fitness: pair.fitness})));
}
if ("s".startsWith("s")) {
  process.exit();
}
})();
*/

interface Execute {
  stdin?: string;
  timeout?: number;
}

// // Not technically asnyc, but doing this to keep our options open
const execute = async (
  file: string,
  args: string[],
  options?: Execute
): Promise<string> => {
  console.log(file, args.join(" "), options ? `<<< ${JSON.stringify(options.stdin)}` : "");

  // Tweaked for the exact problem we're solving
  const maxBuffer = 1024;
  let result: string | undefined = undefined;
  try {
    return execFileSync(file, args, {
      maxBuffer: maxBuffer,
      encoding: "utf8",
      timeout: options?.timeout,
      stdio: "pipe",
      input: options?.stdin,
    });
  } catch (err: any) {
    console.log(err);
    const out = (err.stderr + (err.stderr ? "\n" : "") + err.stdout).substring(0, maxBuffer);
    if (err.code === "ENOBUFS") {
      return `Failed stdout too large:\n${out}`;
    }
    if (err.code === "ETIMEDOUT") {
      return `Failed timed out:\n${out}`;
    }
    if (err.status) {
      return `Failed with exit code: ${err.status}\n${out}`;
    }
    return `Failed:\n${out}`;
  }
};

/*
(async () => {
  // Note I'd probably use https://github.com/YousefED/typescript-json-schema
  // however, node-llama-cpp has it's own grammar generator that currently does not support minItems
  const outputsTs = "./output.ts";
  const tsj = (await import("ts-json-schema-generator")).default;
  const config: import("ts-json-schema-generator").Config = {
    path: outputsTs,
    tsconfig: "./tsconfig.json",
    type: "OutputVideo",
    topRef: false,
    encodeRefs: false,
  };
  const tsjGenerator = tsj.createGenerator(config);
  const schema = tsjGenerator.createSchema(config.type);
  const schemaJson = JSON.stringify(schema, null, 2);
  console.log(schemaJson);
  assert(!schema.definitions || Object.values(schema.definitions).length === 0,
    `Schema should not have definitions, do not use 'export' on anything but the root: ${schemaJson}`);
})();
*/

(async () => {
  const stressTestCase =
    "34,5,1,95,-4, 5 , 21, -1234, 5, 99999, 1,0,5,3,9,1,1,1";
  const testCases = [
    "5,3  ,9,1",
    "1",
    "1,2,3,4,5",
    "4,3,2,1",
    "   2,1   ",
    "11, 22, 33, 44, 55, 66",
    "-1, -2, -3, -4",
    "9876    ,    9867,1234,5,4,3,2,1",
    stressTestCase,
  ];
  //const testCases = [
  //  '{}',
  //  '{"foo": "bar"}',
  //  '5',
  //  'foo',
  //  '{"foo": 5}',
  //  '{"foo": 5, "goo": {}, "bar": "zoo"}',
  //  '{"foo": 5, "goo": {"wiz": "a"}, "bar": "zoo"}',
  //  '{'
  //]
  //const testCases = [
  //  '5 3',
  //  '1',
  //  '99 2',
  //  '1 200',
  //  '3 9',
  //  '2 2 2',
  //]
  //const testCases = [
  //  '{}',
  //  '0',
  //  'null',
  //  'true',
  //  'false',
  //  '[]',
  //  '[1]',
  //  '{"foo": "bar"}',
  //  '{"foo": 5}',
  //]

  const runSample = async (input: string): Promise<string> => {
    return execute("node", ["clone.js"], { stdin: input });
  };

  /*
  const LANGUAGE = "commented standard WASM/WASI with no other libraries";
  const LANGUAGE_GRAMMAR = 'root ::= "(module " [^\\x00]* ")"';
  const compileDest = async (source: string): Promise<string> => {
    await fs.promises.writeFile("/tmp/source.wat", source);
    return execute("wasmtime compile /tmp/source.wat");
  };

  const runDest = async (input: string): Promise<string> => {
    return execute("wasmtime /tmp/source.wat", { stdin: input, timeout: 3 * 1000 });
  };
  */

  const cleanOutput = (candidate: CodeCandidate, output: string) => {
    const sourceFile = `/output/${candidate.uniqueSeed}_source.c`;
    const executableFile = `/output/${candidate.uniqueSeed}_compiled.wasm`;

    return output
      .replaceAll(sourceFile, "src.c")
      .replaceAll(executableFile, "out.wasm");
  };

  const llama = await getLlama();
  const languageDescription = "commented standard C with no libraries";
  const source = await fs.promises.readFile("./clone.js", "utf8");
  const sourceHeader = `Original Source:\n===\n${source}\n---\n`;
  const footer = `Strictly output ONLY safe ${languageDescription}, no surrounding explanations, no examples, no hard-coded test-inputs, nothing else:`;
  const languageGrammar = await llama.createGrammar({
    grammar: 'root ::= "#include" [^\\x00]*'
  });
  const ratingExplain = "Explain what must be fixed for output to match expected: ";
  const ratingGrammar = await llama.createGrammar({
    grammar: `root ::= ([1-9] [0-9]? | "100") "\n${ratingExplain}" [^\n]+`,
  });

  const config = await geneticCodeConfig({
    seed: 0,
    populationSize: 2,
    llmModelPath: "./models/Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf",
    //llmModelPath: "./models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
    testInputs: testCases,
    runSample,

    async compile(candidate) {
      const sourceFile = `/output/${candidate.uniqueSeed}_source.c`;
      await fs.promises.mkdir("output", { recursive: true });
      await fs.promises.writeFile(`.${sourceFile}`, candidate.source);
      const output = await execute("docker", [
        "run",
        "-v",
        "./output:/output",
        "--rm",
        "genetic_llm/clang",
        "/opt/wasi-sdk/bin/clang",
        "--target=wasm32-wasi",
        "-fstack-protector-all",
        "-fno-omit-frame-pointer",
        "-g3",
        sourceFile,
        "-o",
        `/output/${candidate.uniqueSeed}_compiled.wasm`,
      ]);
      return cleanOutput(candidate, output);
    },

    async runCompiled(candidate, input) {
      const executeOpts: Execute = { stdin: input, timeout: 3 * 1000 };
      const output = await execute(
        "docker",
        [
          "run",
          "-i",
          "-v",
          "./output:/output",
          "--rm",
          "genetic_llm/clang",
          "wasmtime",
          `/output/${candidate.uniqueSeed}_compiled.wasm`,
        ],
        executeOpts
      );
      return cleanOutput(candidate, output);
    },

    //async runCompiled(candidate, input) {
    //  const executeOpts: Execute = { stdin: input, timeout: 3 * 1000 };
    //  const result = await execute(`docker run -v ./output:/output --rm silkeh/clang /output/${candidate.uniqueSeed}_compiled`, executeOpts);
    //  if (result.includes("Segmentation fault (core dumped)")) {
    //    return execute(`gdb -batch -q -ex run -ex bt --args /output/${candidate.uniqueSeed}_compiled`, executeOpts);
    //  } else {
    //    return result;
    //  }
    //},

    async testPerformance(code) {
      // TODO(trevor): Don't know that this is a great approach or not
      for (let i = 0; i < 10; ++i) {
        await this.runCompiled(code, stressTestCase);
      }
    },

    promptRandomCandidate(prompt) {
      return prompt(
        `${sourceHeader}Translate this. ${footer}`,
        { grammar: languageGrammar }
      );
    },
  
    promptFixCompileErrors(candidate, errors, prompt) {
      return prompt(
        `${sourceHeader}Last Translation:\n===\n${candidate.source}\n---\nFix Issues:\n===\n${errors}\n---\n${footer}`,
        { grammar: languageGrammar }
      );
    },

    async promptRating(candidate, comparison, prompt) {
      const ratingResult = await prompt(
        `${JSON.stringify(
          comparison,
          null,
          2
        )}\nStrictly do NOT mention the values, quotes, or any examples. The expected and output are NOT equal. Rate similarity of expected and output, 1 = no similarity, 100 = exact match, (1-100): `,
        {
          grammar: ratingGrammar,
          temperature: 0.1,
          maxTokens: 1024,
        }
      );
      const [ratingStr, ratingReasonFull] = ratingResult.split("\n");
      const rating = parseFloat(ratingStr) / 100;
      const explanation = ratingReasonFull.substring(ratingExplain.length).trim();
      return {
        explanation,
        rating
      };
    },

    promptFixTestErrors(candidate, results, prompt) {
      let promptText = `${sourceHeader}Last Translation:\n===\n${candidate.source}\n---\n`;
      for (const result of results) {
        promptText += `Erroneous Stdout:\n===\n${result.output}\n---\nExpected Stdout:\n===\n${result.expected}\n---\n${result.explanation}\n###\n`;
      }
      promptText += `Fix Issues. ${footer}`;
      return prompt(
        promptText,
        { grammar: languageGrammar }
      );
    },

    promptCrossoverBreedFixup(combined, prompt) {
      return prompt(
        `${sourceHeader}Combined Translation:\n===\n${combined}\n---\nFix Issues. ${footer}`,
        { grammar: languageGrammar }
      );
    },

    promptMutationFixup(mutated, prompt) {
      return prompt(
        `${sourceHeader}Mutated Translation:\n===\n${mutated}\n---\nFix Issues. ${footer}`,
        { grammar: languageGrammar }
      );
    },
  });
/*
  await config.crossoverBreed({
    uniqueSeed: 0,
    source:
`
#include <stdio.h>

int main() {
    int num1 = 0, num2 = 0;
    scanf("%d %d", &num1, &num2);

    if (num1 && num2) {
        int result = num1 + num2;
        printf("The result is: %d\\n", result);
    } else {
        printf("Please provide two numbers.\\n");
    }

    return 0;
}
`
  }, {
    uniqueSeed: 0,
    source:
`
#include <stdio.h>

int main() {
    int num1 = 0, num2 = 0;
    scanf("%d %d", &num1, &num2);

    if (num1 && num2) {
        int result = num1 + num2;
        printf("The result is: %d\\n", result);
    } else {
        printf("Please provide two numbers.\\n");
    }

    return 0;
}
`
  }, seedrandom("0"));

return;*/

  let population: CodeCandidate[] = [];
  for (let i = 0; i < 30; ++i) {
    console.log(`+++ GENERATION ${i} +++`);
    const measured = await geneticPass(config, population);
    console.log(JSON.stringify(measured, null, 2));
  }
  console.log("COMPLETE");
})();
