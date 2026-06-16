import { z } from "zod";

/** Unique handle others search by: 3–20 chars, letters/digits/underscore. */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "username must be at least 3 characters")
  .max(20, "username must be at most 20 characters")
  .regex(/^[a-zA-Z0-9_]+$/, "use only letters, numbers, and underscores");

/** The passphrase: also unlocks the local private key, so allow it to be long. */
export const passwordSchema = z
  .string()
  .min(8, "passphrase must be at least 8 characters")
  .max(200);

/** Base64 ECDH P-256 public key (SPKI). Bounded to reject junk. */
export const publicKeySchema = z.string().min(40).max(2000);

export const signupSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  publicKey: publicKeySchema,
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
