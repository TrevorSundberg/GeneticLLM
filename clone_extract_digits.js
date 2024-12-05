process.stdin.on('data', (data) => {
  const str = data.toString();
  for (let i = 0; i < str.length; ++i) {
    const char = str[i];
    if (/[0-9]/.test(char)) {
      console.log(char);
    }
  }
});
