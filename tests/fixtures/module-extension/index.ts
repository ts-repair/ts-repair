// TS2835: Relative import paths need explicit file extensions
// in ECMAScript imports when '--moduleResolution' is 'node16' or 'nodenext'
import { helper, CONSTANT } from "./utils";

// Use the imports
console.log(helper());
console.log(CONSTANT);
