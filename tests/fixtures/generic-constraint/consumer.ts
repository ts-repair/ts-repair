import { createRepository } from "./types.js";

// TS2344: Type 'User' does not satisfy the constraint 'HasId'
// Property 'id' is missing in type 'User' but required in type 'HasId'
interface User {
  name: string;
  email: string;
}

const userRepo = createRepository<User>();
