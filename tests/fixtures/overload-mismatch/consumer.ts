import { process } from "./api.js";

// TS2769: No overload matches
// Neither overload accepts (boolean | string)[]
const mixedArray = [true, "hello", false];
process(mixedArray);
