/**
 * Encryption service - AES-256-GCM encryption/decryption
 */

const crypto = require('crypto');
const config = require('../config');

// Derive 32-byte key from ENCRYPTION_KEY using SHA-256
const key = crypto.createHash('sha256').update(config.ENCRYPTION_KEY).digest();

/**
 * Encrypt plaintext using AES-256-GCM
 * @param {string} text - Plaintext to encrypt
 * @returns {string} - Encrypted string in format: iv:authTag:ciphertext (all hex)
 */
function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt encrypted string using AES-256-GCM
 * @param {string} encrypted - Encrypted string in format: iv:authTag:ciphertext
 * @returns {string} - Decrypted plaintext
 */
function decrypt(encrypted) {
  const [ivHex, authTagHex, ciphertext] = encrypted.split(':');
  
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

module.exports = {
  encrypt,
  decrypt
};
