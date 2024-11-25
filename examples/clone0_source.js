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
