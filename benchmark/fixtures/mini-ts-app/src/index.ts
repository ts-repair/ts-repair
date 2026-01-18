/**
 * Mini TypeScript App - Main entry point
 *
 * This is a test fixture for the ts-repair benchmark that exercises
 * various TypeScript patterns including:
 * - Imports and exports
 * - Async/await
 * - Interfaces and types
 * - Type guards
 * - Optional chaining
 * - Union types
 */

import { ApiClient, createApiClient } from './api/client.js';
import { UserService, isUser, formatUserDisplayName, hasAdminPrivileges } from './services/user.js';
import type { User, CreateUserRequest, UserRole, ApiResponse } from './types/index.js';

// Re-export types for consumers
export type { User, CreateUserRequest, UserRole, ApiResponse };
export { ApiClient, UserService };

/**
 * Application configuration
 */
interface AppConfig {
  apiUrl: string;
  timeout?: number;
  debug?: boolean;
}

/**
 * Initialize the application with configuration
 */
export async function initializeApp(config: AppConfig): Promise<{
  client: ApiClient;
  userService: UserService;
}> {
  const client = createApiClient(config.apiUrl);

  if (config.timeout) {
    // Client timeout is set in constructor, this is just for demonstration
  }

  const userService = new UserService(client);

  if (config.debug) {
    console.log('App initialized with config:', config);
  }

  return { client, userService };
}

/**
 * Fetch and display user information
 */
export async function displayUserInfo(
  userService: UserService,
  userId: number
): Promise<string | null> {
  const user = await userService.getUser(userId);

  if (!user) {
    return null;
  }

  const displayName = formatUserDisplayName(user);
  const isAdmin = hasAdminPrivileges(user);

  return `${displayName}${isAdmin ? ' [ADMIN]' : ''}`;
}

/**
 * Process a batch of user IDs and return formatted output
 */
export async function processBatchUsers(
  userService: UserService,
  userIds: number[]
): Promise<string[]> {
  const users = await userService.batchGetUsers(userIds);
  const results: string[] = [];

  for (const [id, user] of users) {
    if (isUser(user)) {
      results.push(`${id}: ${formatUserDisplayName(user)}`);
    }
  }

  return results;
}

/**
 * Create a new user with validation
 */
export async function createUserWithValidation(
  userService: UserService,
  request: CreateUserRequest
): Promise<User | { error: string }> {
  // Validate email
  const isValidEmail = await userService.validateEmail(request.email);

  if (!isValidEmail) {
    return { error: 'Invalid email address' };
  }

  // Create user
  const user = await userService.createUser(request);
  return user;
}

/**
 * Get users by role with optional filtering
 */
export async function getUsersByRoleFiltered(
  userService: UserService,
  role: UserRole,
  filter?: (user: User) => boolean
): Promise<User[]> {
  const users = await userService.getUsersByRole(role);

  if (filter) {
    return users.filter(filter);
  }

  return users;
}

/**
 * Safe property access helper
 */
export function safeGetUserProperty<K extends keyof User>(
  user: User | null | undefined,
  property: K
): User[K] | undefined {
  return user?.[property];
}

/**
 * Main function demonstrating the application
 */
async function main(): Promise<void> {
  const { userService } = await initializeApp({
    apiUrl: 'https://api.example.com',
    debug: true,
  });

  // Display a single user
  const userInfo = await displayUserInfo(userService, 1);
  console.log('User:', userInfo ?? 'Not found');

  // Process batch
  const batch = await processBatchUsers(userService, [1, 2, 3]);
  console.log('Batch:', batch);

  // Create user
  const newUser = await createUserWithValidation(userService, {
    name: 'John Doe',
    email: 'john@example.com',
  });

  if ('error' in newUser) {
    console.error('Failed to create user:', newUser.error);
  } else {
    console.log('Created user:', newUser.name);
  }

  // Get admins
  const admins = await getUsersByRoleFiltered(userService, 'admin');
  console.log('Admins:', admins.length);
}

// Run main if this is the entry point
main().catch(console.error);
