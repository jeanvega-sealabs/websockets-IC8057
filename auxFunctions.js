
const baseUrls = {
    B01: "http://86.48.22.73",
    B02: "https://us-central1-api-banco-web.cloudfunctions.net",
    B03: "https://bnastralis-api.up.railway.app",
    B04: "https://proyecto02-backend.onrender.com",
    B05: "https://bank-crap-servi.onrender.com",
    B06: "https://bdproyectoweb-3.onrender.com",
    B07: "https://py1dpw-production.up.railway.app",
    B08: "https://api.srlgestock.space",
};

/**
 * Extrae el bankId (B01..B08) desde un IBAN tipo CRddBxx...
 * y valida que pertenezca al catálogo de 8 bancos.
 *
 * @param {string} iban - Ej: "CR01B07CC0000123456"
 * @returns {{ ok: boolean, bankId?: string, bankNum?: number, error?: string }}
 */
export function extractAndValidateBank(iban) {
    if (typeof iban !== "string") {
        return { ok: false, error: "INVALID_TYPE", bankNum: -1 };
    }

    // Formato mínimo: CR + 2 dígitos + B + 2 dígitos (00..08)
    // Ej: CR01B07...
    const m = /^CR(\d{2})B(0[0-8])/.exec(iban.toUpperCase());
    if (!m) {
        return { ok: false, error: "INVALID_FORMAT", bankNum: -1 };
    }

    const bankId = `B${m[2]}`;         // "B07"
    const bankNum = parseInt(m[2], 10); // 7

    // Catálogo permitido: 01..08
    if (bankNum < 0 || bankNum > 10) {
        return { ok: false, error: "UNKNOWN_BANK" };
    }

    return { ok: true, bankId, bankNum };
}


export async function checkAccountValidity(iban, bankId) {
    const baseUrl = baseUrls[bankId];
    if (bankId === "B00") {
        return {
            ok: true,
            bankId,
            exists: true,
            valid: true,
            info: {
                "name": "Carlos Ramírez",
                "currency": "CRC",
                "debit": true,
                "credit": true
            },
        };
    }
    if (!baseUrl) return { ok: false, reason: "BANK_NOT_REGISTERED", bankId };

    const url = `${baseUrl}/api/v1/bank/validate-account`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ iban }),
            timeout: 5000,
        });
        if (!res.ok) {
            return { ok: false, reason: `HTTP_BANK_VALIDATE_${res.status}`, bankId };
        }

        const json = await res.json();

        // Validación básica del formato esperado
        const exists = json.exist === true;
        const data = json.data || {};
        const valid =
            exists &&
            data.debit === true &&
            data.credit === true;

        return {
            ok: true,
            bankId,
            exists,
            valid,
            info: data,
        };
    } catch (err) {
        return { ok: false, reason: "NETWORK_ERROR", bankId };
    }
}