import http from "node:http";
import { Server } from "socket.io";
import { extractAndValidateBank, checkAccountValidity } from './auxFunctions.js';


const PORT = process.env.PORT || 8080;
const srv = http.createServer();
const io = new Server(srv, { cors: { origin: "*" }, transports: ["websocket"] });
const apiToken = "BANK-CENTRAL-IC8057-2025"


// Al conectar, cada banco informa su BANK_ID y se une a su "room"
io.use((socket, next) => {
    const { bankId, bankName, token } = socket.handshake.auth || {};
    if (!bankId) return next(new Error("🏦Central: missing bankId"));
    if (token != apiToken) return next(new Error("🏦Central: missing orinvalid token"))
    socket.data.bankId = bankId;
    socket.data.bankName = bankName;
    socket.join(bankId);
    next();
});

const emitTo = (room, type, data) =>
    io.to(room).emit("event", { ts: new Date().toISOString(), type, data });

const isBankConnected = (bankId) => {
    if (bankId === "B00") return true //mock central
    const room = io.sockets.adapter.rooms.get(bankId); // Set of socketIds
    return (room?.size ?? 0) > 0;
}

// Mapa de transferencias en memoria (solo para la demo)
const TX = new Map(); // id -> { id, from, to, amount, state }

io.on("connection", (socket) => {
    const bankId = socket.data.bankId;
    const bankName = socket.data.bankName;
    console.log(`🏦Central: Banco ${bankName} conectado`);

    // El banco origen inicia una transferencia: transfer.intent
    socket.on("event", async (msg) => {
        const { type, data } = msg || {};
        if (!type) return;

        // 1) ORIGEN -> CENTRAL: transfer.intent
        if (type === "transfer.intent") {
            const { id, from, to, amount, currency } = data || {};
            //VALIDA EL PAYLOAD
            if (!id || !from || !to || !amount || !currency) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "INVALID_PAYLOAD",
                    missing_fields: [
                        ...(!id ? ["id"] : []),
                        ...(!from ? ["from"] : []),
                        ...(!to ? ["to"] : []),
                        ...(!amount ? ["amount"] : []),
                        ...(!currency ? ["currency"] : [])
                    ]
                });;
                return;
            }
            console.log(`🏦Central: ${bankId} intent | ${id}: ${from} -> ${to} ₡${amount}`);

            //VALIDA BANCO ORIGEN Y DESTINO DESTINO
            const fromBankResult = extractAndValidateBank(from)
            const toBankResult = extractAndValidateBank(to)


            //VALIDA QUE LE BANCO EXISYA
            if (!fromBankResult.ok) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "CHECK_BANK_ID",
                    to
                });;
                return;
            }


            //VALIDA QUE LE BANCO EXISYA
            if (!toBankResult.ok) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "UNKNOWN_BANK",
                    to
                });;
                return;
            }

            if (fromBankResult.bankNum == toBankResult.bankNum) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "SAME_BANK_NOT_ALLOWED",
                    from,
                    to
                });;
                return;
            }

            //VALIDA QUE EL BANCO DESTINO ESTE CONECTADO TAMBIEN AL SOCKET
            if (!isBankConnected(toBankResult.bankId)) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "DEST_BANK_OFFLINE",
                    from,
                    to
                });;
                return;
            }

            //VALIDA LA EXISTENCIA DE LA CUENTA
            const validAccount = await checkAccountValidity(to, toBankResult.bankId)
            if (!validAccount.ok) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: validAccount.reason,
                });;
                return;
            }

            if (!validAccount.exists) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "ACCOUNT_NOT_FOUND",
                });;
                return;
            }

            if (!validAccount.valid) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "ACCOUNT_NO_CREDIT",
                });;
                return;
            }


            // VALIDA QUE LA CUENTAS TENGAN LA MISMA MONEDA
            if (validAccount.valid && validAccount.info.currency !== currency) {
                emitTo(bankId, "transfer.reject", {
                    id,
                    reason: "CURRENCY_NOT_SUPPORTED",
                });;
                return;
            }

            TX.set(id, { id, fromBank: fromBankResult.bankId, from, to, toBank: toBankResult.bankId, amount, currency, state: "NEW" });

            // 2) CENTRAL -> ORIGEN: transfer.reserve (solicitar reserva)
            emitTo(fromBankResult.bankId, "transfer.reserve", { id });
            emitTo(toBankResult.bankId, "transfer.init", { id });
            return;
        }

        // 3) ORIGEN -> CENTRAL: transfer.reserve.result
        if (type === "transfer.reserve.result") {
            const { id, ok, reason } = data || {};
            const t = TX.get(id);
            if (!id) return;
            if (!t) return;

            if (!ok) {
                console.log(`🏦Central: ${bankId} reserve.result | ⛔ reject id=${id} reason=${reason || "NO_FUNDS"}`);
                emitTo(t.fromBank, "transfer.reject", { id, reason: reason || "RESERVE_FAILED" });
                emitTo(t.toBank, "transfer.reject", { id, reason: reason || "RESERVE_FAILED" });
                return;
            } else {
                t.state = "RESERVED";
                console.log(`🏦Central: ${bankId} reserve.result | ✅ reserve id=${id}`);
                emitTo(t.toBank, "transfer.credit", t);
                return;
            }
        }

        if (type === "transfer.credit.result") {
            const { id, ok, reason } = data || {};
            const t = TX.get(id);
            if (!id) return;
            if (!t) return;

            if (!ok) {
                console.log(`🏦Central: ${bankId} credit.result | ⛔ reject id=${id} reason=${reason || "CREDIT_FAILED"}`);
                emitTo(t.fromBank, "transfer.reject", { id, reason: reason || "CREDIT_FAILED" });
                emitTo(t.toBank, "transfer.reject", { id, reason: reason || "CREDIT_FAILED" });
                return;
            } else {
                t.state = "CREDIT";
                console.log(`🏦Central: ${bankId} credit.result | ✅ credit id=${id}`);
                emitTo(t.fromBank, "transfer.debit", t);
                return;
            }
        }


        if (type === "transfer.debit.result") {
            const { id, ok, reason } = data || {};
            const t = TX.get(id);
            if (!id) return;
            if (!t) return;

            if (!ok) {
                console.log(`🏦Central: ${bankId} debit.result | ⛔ reject id=${id} reason=${reason || "DEBIT_FAILED"}`);
                emitTo(t.toBank, "transfer.rollback", { id, reason: reason || "DEBIT_FAILED" });
                emitTo(t.fromBank, "transfer.reject", { id, reason: reason || "DEBIT_FAILED" });
                return;
            } else {
                t.state = "DEBIT";
                console.log(`🏦Central: ${bankId} debit.result | ✅ debit id=${id}`);
                emitTo(t.toBank, "transfer.commit", t);
                emitTo(t.fromBank, "transfer.commit", t);
                return;
            }
        }

    });

    socket.on("disconnect", () => {
        console.log(`🏦Central: Desconectado banco ${bankId} - ${bankName}`);
    });
});

srv.listen(PORT, () => console.log(`🏦Central: Central WS escuchando en :${PORT}`));
