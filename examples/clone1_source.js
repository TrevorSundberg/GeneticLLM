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