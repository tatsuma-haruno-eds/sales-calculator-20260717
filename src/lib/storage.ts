const KEY_STORE = "mortgage-diagnosis";
const KEY_NAME = "encryption-key";

type Ciphertext = { iv: string; data: string };
type EncryptedBackup = { version: 1; salt: string; iv: string; data: string };

function openKeyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(KEY_STORE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(KEY_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("暗号鍵の保存領域を開けませんでした。"));
  });
}

async function getEncryptionKey() {
  if (!globalThis.crypto?.subtle) throw new Error("このブラウザーでは安全な暗号化を利用できません。HTTPSまたは対応ブラウザーでお試しください。");
  const database = await openKeyDatabase();
  try {
    const existing = await new Promise<CryptoKey | undefined>((resolve, reject) => {
      const request = database.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(KEY_NAME);
      request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
      request.onerror = () => reject(request.error ?? new Error("暗号鍵を読み込めませんでした。"));
    });
    if (existing) return existing;

    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    try {
      await new Promise<void>((resolve, reject) => {
        const request = database.transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE).add(key, KEY_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error("暗号鍵を保存できませんでした。"));
      });
      return key;
    } catch (cause) {
      if (!(cause instanceof DOMException) || cause.name !== "ConstraintError") throw cause;
      const winner = await new Promise<CryptoKey | undefined>((resolve, reject) => {
        const request = database.transaction(KEY_STORE, "readonly").objectStore(KEY_STORE).get(KEY_NAME);
        request.onsuccess = () => resolve(request.result as CryptoKey | undefined);
        request.onerror = () => reject(request.error ?? new Error("暗号鍵を読み込めませんでした。"));
      });
      if (!winner) throw new Error("暗号鍵の初期化に失敗しました。");
      return winner;
    }
  } finally {
    database.close();
  }
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function backupKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250_000, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function storeEncrypted<T>(key: string, value: T, shouldWrite: () => boolean = () => true) {
  const encryptionKey = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, encryptionKey, encoded);
  if (!shouldWrite()) return;
  const encrypted: Ciphertext = { iv: toBase64(iv), data: toBase64(new Uint8Array(data)) };
  localStorage.setItem(key, JSON.stringify(encrypted));
}

export async function encryptBackup<T>(value: T, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(passphrase, salt);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(value)),
  );
  const backup: EncryptedBackup = {
    version: 1,
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
  return JSON.stringify(backup, null, 2);
}

export async function decryptBackup<T>(raw: string, passphrase: string): Promise<T> {
  const backup = JSON.parse(raw) as EncryptedBackup;
  if (backup.version !== 1 || !backup.salt || !backup.iv || !backup.data) {
    throw new Error("暗号化バックアップの形式が正しくありません。");
  }
  const key = await backupKey(passphrase, fromBase64(backup.salt));
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(backup.iv) },
    key,
    fromBase64(backup.data),
  );
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

export async function clearEncryptedStorage(keys: string[]) {
  keys.forEach((key) => localStorage.removeItem(key));
  const database = await openKeyDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(KEY_STORE, "readwrite").objectStore(KEY_STORE).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("暗号鍵を削除できませんでした。"));
    });
  } finally {
    database.close();
  }
}

export async function readEncrypted<T>(key: string): Promise<T | null> {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  const encrypted = JSON.parse(raw) as Ciphertext;
  if (!encrypted.iv || !encrypted.data) throw new Error("保存データの形式が正しくありません。");
  const encryptionKey = await getEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(encrypted.iv) },
    encryptionKey,
    fromBase64(encrypted.data),
  );
  return JSON.parse(new TextDecoder().decode(decrypted)) as T;
}
