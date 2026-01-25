/**
 * Shared type utilities for builders.
 *
 * This module contains common TypeScript AST traversal utilities
 * used across multiple builders.
 */

import ts from "typescript";

/**
 * Recursively collect type reference names from a type node.
 *
 * This function traverses a TypeNode and collects all type reference identifiers
 * into the provided Set. It handles common type node kinds including:
 * - Type references (e.g., `MyType`, `Array<T>`)
 * - Union and intersection types
 * - Array and tuple types
 * - Conditional types
 * - Function types
 * - Parenthesized, indexed access, and mapped types
 *
 * @param typeNode - The TypeScript type node to traverse
 * @param names - Set to collect type reference names into
 */
export function collectTypeReferences(
  typeNode: ts.TypeNode,
  names: Set<string>
): void {
  if (ts.isTypeReferenceNode(typeNode)) {
    // Get the type name
    if (ts.isIdentifier(typeNode.typeName)) {
      names.add(typeNode.typeName.text);
    } else if (ts.isQualifiedName(typeNode.typeName)) {
      // For qualified names like Namespace.Type, collect the right-most identifier
      names.add(typeNode.typeName.right.text);
    }
    // Also collect from type arguments
    if (typeNode.typeArguments) {
      for (const arg of typeNode.typeArguments) {
        collectTypeReferences(arg, names);
      }
    }
  } else if (
    ts.isUnionTypeNode(typeNode) ||
    ts.isIntersectionTypeNode(typeNode)
  ) {
    for (const subType of typeNode.types) {
      collectTypeReferences(subType, names);
    }
  } else if (ts.isArrayTypeNode(typeNode)) {
    collectTypeReferences(typeNode.elementType, names);
  } else if (ts.isTupleTypeNode(typeNode)) {
    for (const element of typeNode.elements) {
      collectTypeReferences(element, names);
    }
  } else if (ts.isConditionalTypeNode(typeNode)) {
    collectTypeReferences(typeNode.checkType, names);
    collectTypeReferences(typeNode.extendsType, names);
    collectTypeReferences(typeNode.trueType, names);
    collectTypeReferences(typeNode.falseType, names);
  } else if (ts.isFunctionTypeNode(typeNode)) {
    if (typeNode.type) {
      collectTypeReferences(typeNode.type, names);
    }
    for (const param of typeNode.parameters) {
      if (param.type) {
        collectTypeReferences(param.type, names);
      }
    }
  } else if (ts.isParenthesizedTypeNode(typeNode)) {
    collectTypeReferences(typeNode.type, names);
  } else if (ts.isIndexedAccessTypeNode(typeNode)) {
    collectTypeReferences(typeNode.objectType, names);
    collectTypeReferences(typeNode.indexType, names);
  } else if (ts.isMappedTypeNode(typeNode)) {
    if (typeNode.type) {
      collectTypeReferences(typeNode.type, names);
    }
  }
}
