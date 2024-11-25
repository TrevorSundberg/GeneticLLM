const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  // parse and print formatted JSON
  console.log(JSON.stringify(JSON.parse(line), null, 2));
});
