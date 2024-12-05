# GeneticLLM

When I started working with LLMs I immediately became interested in self healing code. To start, the idea is that you can ask an LLM to generate or translate code and it will approximately work, however the code produced will often not compile or may not output exactly what was expected.

Example, asking the LLM to translate this JavaScript program into C:

```js
// Read text from stdin and print any numeric characters we find on separate lines
process.stdin.on('data', (data) => {
  const str = data.toString();
  for (let i = 0; i < str.length; ++i) {
    const char = str[i];
    if (/[0-9]/.test(char)) {
      console.log(char);
    }
  }
});
```

The result (a very close approximated translation):

```c
#include <stdio.h>

int main(void) {
    char c;
    while (1) {
        if (scanf("%c", &c) == 1 && isdigit(c)) {
            putchar(c);
        }
    }
    return 0;
}
```

The C code produced in this example does not compile and produces these errors:

```log
src.c:6:37: error: call to undeclared library function 'isdigit' with type 'int (int)'; ISO C99 and later do not support implicit function declarations [-Wimplicit-function-declaration]
    6 |         if (scanf("%c", &c) == 1 && isdigit(c)) {
      |                                     ^
src.c:6:37: note: include the header <ctype.h> or explicitly provide a declaration for 'isdigit'
```

Self healing code is the concept that we can feed back these compiler errors to the LLM and have it attempt to fix the code. After feeding the compiler errors to the LLM, it generates:

```c
#include <stdio.h>
#include <ctype.h>

int main(void) {
    int c;
    while (scanf("%c", &c) == 1 && isdigit(c)) {
        putchar(c);
    }
    return 0;
}
```

We see that the LLM correctly responded to the compiler error feedback and added `#include <ctype.h>` for `isdigit`. The code now compiles, but if we run the program it does not quite match. First, we can observe that the while loop terminates early once it stops reading numbers. Secondly, it does not print a newline for each output number like `console.log` does.

The JavaScript program with input `1 hi 2,3 $ 4` produces:
```
1
2
3
4
```

The C program with input `1 hi 2,3   4` produces:
```
1
```

If we again let the LLM know that the output was incorrect, it will attempt to fix it and produce:

```c
#include <stdio.h>
#include <ctype.h>

int main() {
    char ch;
    while (scanf("%c", &ch) != EOF) {
        if (isdigit(ch)) {
            printf("%c\n", ch);
        }
    }
    return 0;
}
```

Now this program compiles and produces the intended output similar to the source JS program that we translated from.

For demonstration purposes I've simplified this problem, but in reality it can take hundreds or thousands of self healing iterations to reach correct output, or potentially will never converge. There are many tricks we can do with prompt engineering to achieve better results, such as asking the LLM to describe the issues first before attempting the fix (giving feedback to itself).

Whilst these changes help, fundamentally the LLM has no way to know if the changes it's making are **better or worse**.

## Enter Genetic Algorithms! (GA)

Genetic Algorithms are modeled after the theory of evolution and natural selection. The idea is that the creatures that survive are the ones who best adapted to their environment; survival of the fittest. If we can make up what the concept of a creature is (a solution to a problem), and also define what fitness means (better attempts at a solution), we can evolve creatures generation by generation, simulating random gene selection and breeding, mutation, diversity and migration, etc.

Imagine you were standing in a valley in the mountains with no cell signal. Your goal is to climb to the highest hill, but there's a thick fog all around and you can't see anything ahead. You can however poke randomly around with a stick and tell if the areas around you are higher or lower. You can choose to always walk toward the higher path, but it's possible you'll end up on the top of a small hill. Remember, the fog is so thick you can't even see the mountains, nor do you know how high the highest one is. Now imagine there are 100 of you, and though you cannot see, you can communicate. Rather than everyone choosing to climb the same hill, wouldn't it be better if you randomly spread out and find other potentially higher hills? You could choose to have everyone walk around completely randomly, but if one of you starts to find a higher hill than the others, don't you think some of them should group together and try to search around that hill together?

This is the analogy I like to use for why we employ Genetic Algorithms. Fitness indicates whether we're climbing up or down. Breeding allows two creatures to attempt to follow a similar path to the solution. Mutation helps a creature and its offspring to avoid staying at the top of a hill forever. Diversity allows us to find many hills and potentially higher ones.

## Genetic Algorithm Example

Let's try to solve the problem of finding a set of 3 numbers that add up to 10, for example:
```
1 + 5 + 4 = 10
```

There are many solutions to this problem, and as you notice if you increase how many numbers and the target to a larger number, the problem becomes more difficult with many more solutions. Genetic Algorithms (GAs) excel at finding solutions to this sort of problem. Here, `1 + 5 + 4` is considered a solution, but we also call it our creature (or individual, chromosome, many names for it in GAs). To start, we generate an initial random population by choosing random numbers, let's say there are five members in our population:

```
5 + 3 + 9 = 17
7 + 3 + 5 = 15
2 + 0 + 3 = 5
8 + 7 + 1 = 16
0 + 1 + 2 = 3
```

The fitness is how close our result was to 10, note that a fitness of 0 is actually a solution, and higher fitnesses here are worse.

```
5 + 3 + 9 = 17  |  abs(17 - 10) = 7 fitness
7 + 3 + 5 = 15  |  abs(15 - 10) = 5 fitness
2 + 0 + 3 = 5   |  abs( 5 - 10) = 5 fitness
8 + 7 + 1 = 16  |  abs(16 - 10) = 6 fitness
0 + 1 + 2 = 3   |  abs( 3 - 10) = 7 fitness
```

Now that we've evaluated fitness, we need to perform the next step, breeding! Similar to life, creatures tend to mate with other creatures that they consider to be more fit. In GA, we implement this using weighted random selection, where the better fitness gets picked more often. There are many approaches to selection in GAs, however this project uses Ranked Selection; sort members in an array by fitness, and then randomly generate an index that's weighted toward the fit side of the array. This weighting is also referred to as "elitism", picking the more elite ones:

```
7 + 3 + 5 = 15  |  abs(15 - 10) = 5 fitness
2 + 0 + 3 = 5   |  abs( 5 - 10) = 5 fitness
8 + 7 + 1 = 16  |  abs(16 - 10) = 6 fitness
5 + 3 + 9 = 17  |  abs(17 - 10) = 7 fitness
0 + 1 + 2 = 3   |  abs( 3 - 10) = 7 fitness
```

We may for example randomly choose to breed these two more fit candidates:

```
7 + 3 + 5 = 15  |  abs(15 - 10) = 5 fitness
8 + 7 + 1 = 16  |  abs(16 - 10) = 6 fitness
```

Breeding is also referred to as crossover in GAs. The crossover operation involves taking 50% of each "gene" from either parent similar to life. Here, we consider a gene to be one of the numbers:

```
7 & 8, random roll: 7
3 & 7, random roll: 3
5 & 1, random roll: 1
```

Our new child becomes `7 + 3 + 1 = 11`. We repeat this step until we have five new children. In this case, we can see the fitness of the new child is `abs(11 - 10) = 1 fitness`. We found a more fit solution! Note that it's also possible to make children that are worse. However, by using the elitism/fitness concept, we will gradually take steps that are towards a more fit population; better solutions to the problem.

You can think of GA as a way to find global maximum solutions for a math problem by randomly searching around and climbing hills, though many times GA's will instead find local maximums instead of global maximums, which is why we need diversity!

Another concept in GA is mutation: randomly picking and mutating a gene based on a mutation rate, simulating radiation and chemicals affecting our genes. The mutation rate is typically that less than 1% of genes are modified. Mutation helps to ensure that we don't get stuck with the same local maximum solution. Islanding and maintaining separate populations that migrate also helps with diversifying solutions, as well as introducing completely random new solutions as a means of diversifying (called diversity injection).

All of these concepts help us to randomly search a solution space in a gradually climbing manner, ideally not getting stuck at the top of a smaller hill, preventing us from ever reaching a true solution.

## Genetic Code Translation

Aince we're tackling code translation as the first problem to solve with GeneticLLM, we can define our "creature" as a seed to the LLM, which we then use to generate the C program (both are stored together). The fitness would then be:

1. Does it compile?
2. Does it crash or timeout?
3. Does it pass a suite of tests?
4. Does it perform well?

With the above questions, we can come up with a fitness scoring criteria. For simplicity, using the length in characters of the compiler error output is sufficient (more errors = worse fitness). Once we have a compiling program, we then base fitness on how many tests pass in the test suite. Note that this also covers crashing programs, as they will not pass the tests and will be ranked lower. Once we have programs that pass all tests, we can finally rank by performance (faster programs are better).

With ranked based selection, we only need a sorted array of creatures by fitness. This means that fitness does not need to be boiled down to a single number, but really anything sortable, which allows us to break our scoring into tiers: compiling / testing / performance.

## Code Generation and Self Healing

To generate the initial random creatures (C translations) we use a random seed and a higher temperature in the LLM which produces more varied outputs. The goal of GeneticLLM's translation is to combine the hill climbing features of GA with the self healing code features of an LLM. For each creature, we do a fixed number of self healing iterations through the LLM. As mentioned above, we give the compiler errors as feedback to a prompt (including the original source, and the last attempted translation). Ideally after a few iterations we end up with a program that is closer to compiling and passing the tests.

Similar to GA, it is also possible for the self healing LLM to create a worse program. We pick the best attempt of all the LLM iterations (applying our fitness function again here).

For demo purposes and translating to C, we use the clang compiler and run the generated code within a docker container to emulate a sandboxed environment. We capture the compiler errors from clang, as well as the stdout from running any valid built C program. We also compare stdout of the generated program with stdout from our sample JavaScript program. If the output differs, we give that feedback to the LLM too.

## Hill Climbing & Comparing Test Outputs

One observation about genetic algorithms is that they tend to do better with fitness functions that can be climbed gradually (floating-point fitness) rather than stair steps (integer fitness). For example, if we were to score our translation by how many tests it passed, the fitness would be an integer value. Even if we divide it by the total number of tests, it's still stair steps unless we have a considerable number of tests (making the stair steps very small).

In the analogy about wandering around in fog looking for hills, imagine now that every hill was just stair steps and there were large flat areas. Poking the stick around trying to find the next hill to climb becomes difficult because everything is flat, there are no gradual hills, unless we happen to find a step.

In order to mitigate this, when we fail a test rather than giving a score of 0, we actually want to judge how closely it matched the output. Effectively we want a floating-point value from [0, 1] instead of a boolean 0 or 1.

One method is to ask the LLM itself how it would score the similarities and then use a grammar with the LLM to constrain it to output score numbers only. Obviously we could ask for a floating-point value, however the LLM seems to do better with a 1-100 scoring:

```
Rate similarity of expected and output, 1 = no similarity, 100 = exact match, (1-100):
```

An example llama.cpp grammar that outputs any number from 1-100:
```
root ::= ([1-9] [0-9]? | "100")
```

The advantages of asking the LLM is that it's able to recognize patterns more easily, for example whilst `0, 0, 0, 0` might not match the same output as `1 2 3 4`, the LLM can often identify that it has the same number of elements and that the result is numeric, but also identifies the differences that one is all zeros and uses commas whilst the other does not. It's useful to also ask the LLM for its reasoning, as we can use that as feedback for the self healing iterations. The disadvantage of using an LLM is that it can hallucinate, sometimes wildly predicting a score of 100 and then contradict itself in the reasoning. Though these hallucinations may occur, it's important to remember that as long as it's approximately correct more often than not, we'll still gradually grow toward a solution.

Another approach is to use Sentence Similarity to match stdout. This similarity rating effectively turns the expected output and the actual output into a numeric vector, and then uses a dot product to compare how close they are to each other. Our current implementation uses [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2). This model directly outputs a value of [0, 1] for similarity.

Lastly, both the above methods have the pitfalls that they can consider inputs such as `1` compared to `1 2 3 4` as closer than they should be (> 50%). Obviously we can tell that those two outputs from a program are quite different by length. The final scoring we perform is to take the smaller string's length and divide it by the larger string, in this example it's `1 / 7 = 0.14285714285`.

This is an active area of experimentation, but the current implementation combines scores from all three and averages them. This tends to produce results that gradually get closer to the correct output in length and content.

## Code Breeding / Crossover

Breeding two C programs is no trivial task. There are many approaches that GAs use for breeding code, such as boiling it down to an Abstract Syntax Tree (AST) and combining from there. However, with an LLM at our disposal we can get creative. Initially the design was to ask the LLM to take two different translations and mix them up itself, using 50% of each. However, many of the smaller models often deviate from instructions and would take 99% of one program and only 1% of the other. This was observed even when using the excellent model [Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf](https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF).

A better approach was needed (and still a point of active research). The current approach is to select 50% of the lines from each and combine them randomly into a single C translation. Obviously, this typically does NOT result in a working C program. However, we apply one single LLM fixup pass, asking it to take all the random lines and turn them back into a valid C program. This approach appears to work quite well.

For example the two programs to be mated:
```c
#include <stdio.h>

int main(void) {
    int c;
    while (scanf("%c", &c) == 1 && isdigit(c)) {
        putchar(c);
    }
    return 0;
}
```

```c
#include <stdio.h>

int main() {
    int c;
    while ((c = getchar()) != EOF) {
        if (c >= '0' && c <= '9') {
            putchar(c);
        }
    }
    return 0;
}
```

Applying crossover by randomly selecting genes (lines of C code) looks like:
```c
#include <stdio.h>

int main() {
    char ch;
    while ((c = getchar()) != EOF) {
    while (scanf("%c", &c) == 1 && isdigit(c)) {
            putchar(c);
    }
    return 0;
}
```

Obviously the lines are garbed and would never compile. However after a single pass of LLM fixup where we provide the original JavaScript too, it produces:
```c
#include <stdio.h>

int main() {
    char ch;
    while (scanf("%c", &ch) != EOF) {
        if (isdigit(ch)) {
            putchar(c);
        }
    }
    return 0;
}
```

And now we have a much better looking creature that uses "dna" from both parents!

## Code Mutation

For mutation, we have a similar problem: mutating a C program into another valid C program is not trivial. So in our case, we randomly select characters and mutate them into other ascii characters based on the mutation rate. We then perform another LLM fixup.

For example the program:
```c
#include <stdio.h>

int main() {
    char ch;
    while ((ch = getchar()) != '\n') {
        if (ch >= '0' && ch <= '9') {
            putchar(ch);
        }
    }
    return 0;
}
```

Could be mutated into:
```c
#include <stdio.h>

int main() {
    chhr ch;
    while ((ch = getchar()) P= '\n') {
        if (ch >= '0' && ch <= '9') {
            putchar(ch);
        }
    }
    returnf0;
}
```

Note that: `char` mutated into `chhr`, `!=` mutated into `P=`, and `return 0` mutated into `returnf0`.

After LLM fixup:
```c
#include <stdio.h>

int main() {
    int ch;
    while ((ch = getchar()) != EOF) {
        if (ch >= '0' && ch <= '9') {
            putchar(ch);
        }
    }
    return 0;
}
```

Because of the mutation `chhr` the LLM decided to change `char ch` into `int ch`. Fascinatingly, probably because of the `int` as well as the `P=`, the LLM decided to change the `\n` into EOF, which is actually more correct and now handles newlines! It's also interesting to note that the `int` change was required as EOF is represented as an int, not a char.

## Results!

This is a simulation that we ran with the following parameters:
```js
populationSize: 30
generations: 30
model: "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
sentenceSimilarity: "all-MiniLM-L6-v2"
```

Showing the top result and it's fitness:

**TODO: THIS TABLE IS NOT COMPLETE YET, I NEED TO FILL IT OUT!**

| Generation | Compile Errors      | Unique Test Results | Passed Tests        | Total Run Seconds   |
| ---------- | ------------------- | ------------------- | ------------------- | ------------------- |
| `0`        | 0                   | 1                   | 5.782437541248998   | 0                   |
| `1`        | 0                   | 1                   | 9                   | 3.3058907069999988  |

More example translations that have been done correctly:

#### Translation Example 1 (JavaScript):

```js
function sortNumberArray(arr) {
  // Iterate over the array multiple times
  for (let i = 0; i < arr.length; i++) {
    // Compare each pair of adjacent elements
    for (let j = 0; j < arr.length - 1; j++) {
      // If the current element is greater than the next element, swap them
      if (arr[j] > arr[j + 1]) {
        [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
      }
    }
  }
  // Return the sorted array
  return arr;
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (data) => {
  const numbers = data.toString().trim().split(',').map(num => parseFloat(num.trim()));
  const sortedNumbers = sortNumberArray(numbers);
  console.log(sortedNumbers.join(', '));
});

```

#### Correct Translation Result 1 (C):

```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int sortNumberArray(int* arr, size_t length) {
  for (size_t i = 0; i < length; i++) {
    for (size_t j = 0; j < length - 1; j++) {
      if (arr[j] > arr[j + 1]) {
        int temp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = temp;
      }
    }
  }
  return 0;
}

int main() {
  char buffer[256];
  if (fgets(buffer, sizeof(buffer), stdin) != NULL) {
    int* numbers = calloc(16, sizeof(int));
    size_t num_elements = 0;
    char* token = strtok(buffer, ",");
    while (token != NULL && num_elements < 16) {
      int number = strtol(token, NULL, 10);
      numbers[num_elements++] = number;
      token = strtok(NULL, ",");
    }

    sortNumberArray(numbers, num_elements);

    for (size_t i = 0; i < num_elements; i++) {
      printf("%d", numbers[i]);
      if (i + 1 != num_elements) printf(", ");
    }
    printf("\n");

    free(numbers);
  }
  return 0;
}
```

One interesting observation is that translation to C programs tend to use hardcoded array sizes (such as `buffer[256]`). This is acceptable because it handles the test results that we threw at it, but adding more tests would possibly force this to dynamically allocate instead.

#### Translation Example 2 (JavaScript):

```js
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let input = '';

rl.on('line', (line) => {
  input += line + ' ';
}).on('close', () => {
  const numbers = input.trim().split(' ').map(Number);
  if (numbers.length >= 2) {
    const result = numbers[0] + numbers[1];
    console.log(`The result is: ${result}`);
  } else {
    console.log('Please provide two numbers.');
  }
});
```

#### Correct Translation Result 2 (C):

```c
#include <stdio.h>

int main() {
    int num1 = 0, num2 = 0;
    scanf("%d %d", &num1, &num2);

    if (num1 && num2) {
        int result = num1 + num2;
        printf("The result is: %d\n", result);
    } else {
        printf("Please provide two numbers.\n");
    }

    return 0;
}
```

As we can observe, there are still slight differences in code paths between the two. For example, the C translation does not correctly handle the input `0` as it will always print `Please provide two numbers`. However, it's a fault of our test suite as in the tests we only ran the inputs:
```
5 3
1
99 2
1 200
3 9
2 2 2
```

And `0` was not one of them, whoops! Still, the result is pleasing :)

## Observed Issues & Potential Solutions

1. When testing these randomly generated programs, it's important to know that they can do **ANYTHING** to the system you run it on. This is why you should run it under a sandbox.
    - I chose to build using clang specifically targeting wasm32 using the [wasi-sdk docker image](https://github.com/WebAssembly/wasi-sdk?tab=readme-ov-file#docker-image). I then run wasmtime inside a docker container to execute the compiled C wasm. There's probably more sandboxing that should be done in a production environment (running gvisor for the container runtime, etc). One disadvantage currently is that the debug tools for wasm32 are lacking, for example clang is missing `-fsanitize=address -fsanitize=thread -fsanitize=memory` for wasm32 targets, it's also not possible to run tools like gdb for stacks or valgrind to find undefined behavior, leaks, etc. Eventually many targets will be supported, including native C.

2. If the prompts given to the LLM actually show the test inputs or outputs, the LLM has a tendency to directly copy and hard code them, even when instructed not to. The observed behavior is that every test in the suite ends up incorrectly outputting the same output.
    - One solution is to change how we score fitness, by adding in another factor that checks how unique the output is compared to the original JavaScript translation `(number of unique outputs / total tests)`. This works well as it penalizes all the following cases: hard-coded inputs/outputs, crashes, and timeouts. Because all of them produce the same output, those creatures get a lower fitness score.
    - Another solution that has yet to be fully explored is attempting to use an LLM to describe the differences in output vs expected, and never let the actual translation see test inputs/outputs. In a way, it's reminiscent of blind reverse engineering, passing notes without specifics.
    - We also shuffle the test order for this reason, to prevent many solutions getting stuck on the same test inputs. This is not a fix, but it produces more varied outputs.

3. Occasionally a program is generated that produces an infinite spam of output. The issue becomes that an LLM has a fixed size context window, and we must truncate this output to fit within the LLM context window (even if doing the blind description as mentioned above).
    - We have a fixed size buffer to capture this output and terminate the program if it goes beyond. While this works, in the future it will be necessary to start managing context window and token sizes

4. It was observed that occasionally the programs regress and go backwards. This is because the nature of code generation produces programs that perform wildly differently, and usually there is an outlier at the top that performs exceptionally well, but it's not always picked.
    - Stronger elitism can help this, however we want to avoid getting stuck at local minimums. Possibly we can tweak elitism as we get closer to a true result.
    - Another idea would be resurrection, also called best-solutions, reintroducing elites, or diversity revival. The idea would be to bring back old solutions that worked well, especially when we detect that we start regressing. Another topic to look into is GA Restart Mechanisms.

## Open Questions

1. I wonder if there are any merits to training or fine-tuning an LLM on the fly as we run generation to generation. It's an idea, I'm not sure how it would be used exactly, but with GeneticLLM we are effectively generating a new data set of what it looks like to go from a bad program to a better program... Can we use that?

2. Is there a better representation of a creature than the seed to the LLM? The seed obviously affects the behavior, but not in any kind of predictable way (it's intended to be random). Even attempting to gene splice the bits of a seed makes little sense as it's again, effectively random behavior.

3. Are there any other AI topics that can help this code translation/generation to converge faster?

## Future

1. We can eventually write adapters that target any language and run a suite of different containers.

2. The use of GeneticLLM extends beyond code generation. For example, we should be able to use this framework to generate prompts where we know the output we expect and we let it generate prompts that could potentially generate something close to that output. That said, this is where I am out of my depth. There are probably many better ways of doing prompt engineering that I am unaware of.

3. At some point we can perform islanding (locally, or even on remote machines). Another interesting point of islanding is that we could try different AI models with different prompt setups, but the same GA. It would be so fascinating to migrate solutions between these islands while running and would probably provide much higher diversity since the LLMs were trained on different data.

