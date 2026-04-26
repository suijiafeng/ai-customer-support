import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
/**
 * API Key 落盘加密（AES-256-GCM）：密钥由 AUTH_SECRET 派生（sha256 加域前缀），
 * 防的是数据文件/库泄露时明文密钥外泄。换 AUTH_SECRET 后旧密文无法解开，
 * 解密失败按"未配置密钥"处理，需要在模型管理里重新填一次。
 */
function deriveKey(secret) {
    return createHash('sha256').update(`assistflow:ai-provider-key:${secret}`).digest();
}
/** 加密：返回 v1.<iv>.<authTag>.<cipher>（base64url 分段） */
export function sealSecret(plain, secret) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}
/** 解密：格式不符 / 密钥不匹配时返回 null（不抛出） */
export function openSecret(sealed, secret) {
    if (!sealed)
        return null;
    const parts = String(sealed).split('.');
    if (parts.length !== 4 || parts[0] !== 'v1')
        return null;
    try {
        const [, ivB64, tagB64, dataB64] = parts;
        const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivB64, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
        return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=secret-box.js.map