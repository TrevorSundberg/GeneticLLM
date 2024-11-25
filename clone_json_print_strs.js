const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let jsonData = '';

rl.on('line', (line) => {
  jsonData += line;
});

rl.on('close', () => {
  try {
    const parsedData = JSON.parse(jsonData);
    printStrings(parsedData);
  } catch (error) {
    console.error('Invalid JSON input');
  }
});

function printStrings(data) {
  if (typeof data === 'string') {
    console.log(data);
  } else if (Array.isArray(data)) {
    data.forEach(item => printStrings(item));
  } else if (typeof data === 'object' && data !== null) {
    Object.values(data).forEach(value => printStrings(value));
  }
}
