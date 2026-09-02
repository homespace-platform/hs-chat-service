export interface UserContext {
  userId: string;
  email?: string;
  role?: string;
  authorities: string[];
}
