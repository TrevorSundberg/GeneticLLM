import seedrandom from "seedrandom";
import { defaulted } from "./util.js";

export interface GeneticConfigTweakables {
  // The number of candidates (solutions, indviduals, chromosomes, etc.) in each generation
  // Larger population sizes allow us to explore more potential solutions at the cost of compute time
  // Default is 100
  populationSize?: number;

  // A seed to ensure determanism. If no seed is used then it will be random / non-determanistic
  // Note that after each pass, this will be modified to be a new seed for the next pass
  seed?: number | string;

  // A [0, 1] value indicating how strongly we prefer to select those with
  // a higher fitness rank to either breed or be a part of the next generation
  // The stronger the preference toward the fittest the faster we'll converge on a solution, however
  // we are more likely to miss a potential different solution
  // 0 = uniform distibution
  // 1 = strong bias toward most fit
  // Default is 0.35
  elitism?: number;

  // A [0, 1] probability that we introduce a new random candidate instead of breeding
  // Default is 0.01
  diversityInjectionRate?: number;

  // A [0, 1] probability of how likely we are to breed to create a new
  // candidate vs. allowing an existing parent through to the next generation
  // Default is 0.7
  crossoverRate?: number;

  // A [0, 1] probability of mutation for a gene within the candidate
  // Default is 0.001
  mutationRate?: number;
}

export interface MeasuredCandidate<Candidate, Fitness> {
  candidate: Candidate;
  fitness: Fitness;
}

export interface GeneticConfig<Candidate, Fitness>
  extends GeneticConfigTweakables {
  // Generate a candidate with random genes
  randomCandidate: (random: seedrandom.PRNG) => Promise<Candidate> | Candidate;

  // How well does the candidate solve the problem (or how 'fit' is the species for survival)
  // Note that Fitness is not restricted to being a number, and can even be a structure
  // This is possible because we use rank based selection rather than weighted which requires a numeric fitness
  simulateAndMeasureFitness: (
    candidate: Candidate,
    random: seedrandom.PRNG
  ) =>
    | Promise<MeasuredCandidate<Candidate, Fitness>>
    | MeasuredCandidate<Candidate, Fitness>;

  // Compare the fitness of two candidates. The return value should be usable in sort (comparator).
  // This is used to perform rank based selection.
  compareFitness: (a: Fitness, b: Fitness) => number;

  // Crossover (breed / mate) two candidates together to get a new child that
  crossoverBreed: (
    a: Candidate,
    b: Candidate,
    random: seedrandom.PRNG
  ) => Promise<Candidate> | Candidate;

  mutate?: (
    candidate: Candidate,
    mutationRate: number,
    random: seedrandom.PRNG
  ) => Promise<Candidate> | Candidate;
}

export const geneticPass = async <Candidate, Fitness>(
  config: GeneticConfig<Candidate, Fitness>,
  population: Candidate[]
): Promise<MeasuredCandidate<Candidate, Fitness>[]> => {
  const random = seedrandom(config.seed?.toString());

  // Add new random candidates if we need to (especially on initialization)
  // If the population size was reduced this iteration, we don't need to truncate
  // the population array because it will naturally be reduced below during selection
  const populationSize = defaulted(config.populationSize, 100);
  for (let i = population.length; i < populationSize; ++i) {
    population.push(await config.randomCandidate(random));
  }

  const measuredPopulation: MeasuredCandidate<Candidate, Fitness>[] = [];
  for (const candidate of population) {
    measuredPopulation.push(
      await config.simulateAndMeasureFitness(candidate, random)
    );
  }

  // Sort fitness in ascending order for rank based selection
  measuredPopulation.sort((a, b) =>
    config.compareFitness(a.fitness, b.fitness)
  );

  const elitism = Math.max(defaulted(config.elitism, 0.35), 0);

  const selectCandidate = () =>
    measuredPopulation[
      Math.floor(
        (1 - Math.pow(random(), 1 + elitism)) * measuredPopulation.length
      )
    ].candidate;

  // Clear the last population to make way for the new generation
  population.length = 0;

  // If a mutation function was provided, use it to mutate our candidate
  const mutate = (candidate: Candidate) =>
    config.mutate
      ? config.mutate(candidate, defaulted(config.mutationRate, 0.001), random)
      : candidate;

  for (let i = 0; i < populationSize; ++i) {
    // Diversity injection introduces random candidates into the population to maintain
    // variety, prevent premature convergence, and explore new areas of the search space
    const diversityInjectionRoll = random();
    if (
      diversityInjectionRoll < defaulted(config.diversityInjectionRate, 0.01)
    ) {
      console.log("ADDING DIVERSE CANDIDATE");
      // We don't need to mutate here since the candidate is already random
      population.push(await config.randomCandidate(random));
      continue;
    }

    // Crossover probabilty balances exploration and exploitation by controlling how often
    // new combinations of genetic material are generated versus preserving existing solutions
    const crossoverRoll = random();
    if (crossoverRoll < defaulted(config.crossoverRate, 0.7)) {
      const candidateA = selectCandidate();
      let candidateB = selectCandidate();

      // We already have a case for candidate graduation (neither a diverse injection nor a crossover/breed)
      // However, it's possible that breeding selects the same candidate, we allow this
      if (measuredPopulation.length > 1) {
        while (candidateA === candidateB) {
          candidateB = selectCandidate();
        }
      }

      console.log("ADDING CROSSOVER CANDIDATE", candidateA, candidateB);

      // Perform both breeding and then mutation at the given mutation rate
      population.push(
        await mutate(
          await config.crossoverBreed(candidateA, candidateB, random)
        )
      );
      continue;
    }

    // Since we got here, no crossover, we're preserving a previous potential solution
    const graduated = selectCandidate();
    console.log("GRADUATING CANDIDATE", graduated);
    population.push(await mutate(graduated));
  }

  // Set the seed so next time we re-enter, we initialize a new random (but still determanistic)
  config.seed = random();
  return measuredPopulation;
};
