// Missing await - TypeScript should suggest adding await
async function fetchData(): Promise<string> {
  return "data";
}

function processData() {
  // Error: await is only valid in async function
  const data = await fetchData();
  console.log(data);
}

processData();
