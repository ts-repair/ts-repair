/**
 * User service for managing user data
 */

import { ApiClient } from '../api/client.js';
import type {
  User,
  CreateUserRequest,
  UpdateUserRequest,
  PaginatedResponse,
  QueryOptions,
  ApiResponse,
  UserRole,
} from '../types/index.js';

export class UserService {
  private client: ApiClient;
  private cache: Map<number, User>;
  private cacheExpiry: number;

  constructor(client: ApiClient, options?: { cacheExpiry?: number }) {
    this.client = client;
    this.cache = new Map();
    this.cacheExpiry = options?.cacheExpiry ?? 60000;
  }

  async getUser(id: number): Promise<User | null> {
    // Check cache first
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }

    const response = await this.client.get<User>(`/users/${id}`);

    if (response.status === 200) {
      this.cache.set(id, response.data);
      return response.data;
    }

    return null;
  }

  async getUsers(options?: QueryOptions): Promise<PaginatedResponse<User>> {
    const params = new URLSearchParams();

    if (options?.page) {
      params.set('page', options.page.toString());
    }
    if (options?.pageSize) {
      params.set('pageSize', options.pageSize.toString());
    }
    if (options?.sortBy) {
      params.set('sortBy', options.sortBy);
    }
    if (options?.sortOrder) {
      params.set('sortOrder', options.sortOrder);
    }

    const query = params.toString();
    const endpoint = query ? `/users?${query}` : '/users';

    const response = await this.client.get<PaginatedResponse<User>>(endpoint);
    return response.data;
  }

  async createUser(request: CreateUserRequest): Promise<User> {
    const response = await this.client.post<User>('/users', request);
    return response.data;
  }

  async updateUser(id: number, request: UpdateUserRequest): Promise<User> {
    const response = await this.client.put<User>(`/users/${id}`, request);

    // Invalidate cache
    this.cache.delete(id);

    return response.data;
  }

  async deleteUser(id: number): Promise<boolean> {
    const response = await this.client.delete<void>(`/users/${id}`);
    this.cache.delete(id);
    return response.status === 200;
  }

  async getUsersByRole(role: UserRole): Promise<User[]> {
    const response = await this.client.get<User[]>(`/users/role/${role}`);
    return response.data;
  }

  async validateEmail(email: string): Promise<boolean> {
    const response = await this.client.get<{ valid: boolean }>(`/users/validate-email?email=${encodeURIComponent(email)}`);
    return response.data.valid;
  }

  async batchGetUsers(ids: number[]): Promise<Map<number, User>> {
    const results = new Map<number, User>();

    // Check cache for each id
    const uncachedIds: number[] = [];
    for (const id of ids) {
      const cached = this.cache.get(id);
      if (cached) {
        results.set(id, cached);
      } else {
        uncachedIds.push(id);
      }
    }

    // Fetch uncached users
    if (uncachedIds.length > 0) {
      const response = await this.client.post<User[]>('/users/batch', { ids: uncachedIds });

      for (const user of response.data) {
        results.set(user.id, user);
        this.cache.set(user.id, user);
      }
    }

    return results;
  }

  clearCache(): void {
    this.cache.clear();
  }

  getCacheSize(): number {
    return this.cache.size;
  }
}

// Type guard for checking if a value is a valid user
export function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj['id'] === 'number' &&
    typeof obj['name'] === 'string' &&
    typeof obj['email'] === 'string' &&
    isUserRole(obj['role'])
  );
}

// Type guard for UserRole
export function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'user' || value === 'guest';
}

// Utility function to format user display name
export function formatUserDisplayName(user: User): string {
  return `${user.name} (${user.email})`;
}

// Utility to check if user has admin privileges
export function hasAdminPrivileges(user: User): boolean {
  return user.role === 'admin';
}

// Utility to get user initials
export function getUserInitials(user: User): string {
  const parts = user.name.split(' ');
  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  }
  return (user.name[0] ?? '').toUpperCase();
}
