// Multiple errors:
// 1. Missing import for 'add'
// 2. Missing import for 'Config'
// 3. Spelling error 'nmae' instead of 'name'

const sum = add(1, 2);

const config: Config = {
  nmae: "test", // spelling error
  debug: true
};

console.log(sum, config);
