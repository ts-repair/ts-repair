// Define a constrained generic interface
export interface HasId {
  id: string;
}

export interface Repository<T extends HasId> {
  get(id: string): T | undefined;
  set(item: T): void;
}

export function createRepository<T extends HasId>(): Repository<T> {
  const items = new Map<string, T>();
  return {
    get: (id) => items.get(id),
    set: (item) => items.set(item.id, item),
  };
}
