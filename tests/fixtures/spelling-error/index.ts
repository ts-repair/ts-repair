// Spelling error - TypeScript should suggest fixing the typo
interface User {
  name: string;
  email: string;
}

function greetUser(user: User): string {
  return `Hello, ${user.naem}!`; // Error: Property 'naem' does not exist. Did you mean 'name'?
}
