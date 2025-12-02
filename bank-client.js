import { io } from "socket.io-client";

const CENTRAL_URL = "http://137.184.36.3:6000";
const BANK_ID = "B01";

const socket = io(CENTRAL_URL, {
    transports: ["websocket"],
    auth: { bankId: BANK_ID, token: "BANK-CENTRAL-IC8057-2025", bankName: "B01" }
});

socket.on("connect", () => {
    console.log(`🏦 ${BANK_ID} conectado al Central`);


    const id = "B01-" + Math.floor(Math.random() * 100000);
    const intent = {
        id,
        from: "CR01B05CC0000",
        to: "CR01B01111111111112",
        amount: 25000,
        currency: "CRC"
    };
    console.log("➡️ Enviando transfer.intent", intent);
    socket.emit("event", { type: "transfer.intent", data: intent });

});

// Handlers mínimos para eventos del Central
socket.on("event", (evt) => {
    const { type, data } = evt || {};
    if (!type) return;


    if (type === "transfer.reserve") {
        //El banco hace la reserva de dinero 
        console.log(`📥 ${BANK_ID} reserve request`, data);
        socket.emit("event", { type: "transfer.reserve.result", data: { id: data.id, ok: true } });
        //socket.emit("event", { type: "transfer.reserve.result", data: { id: data.id, ok: false, reason: "NO_FUNDS" } });
    }

    if (type === "transfer.init") {
        // El banco destino recibe un intento de acreditacion
        // hace la reserva de dinero 
        console.log(`📥 ${BANK_ID} init request`, data);
    }

    if (type === "transfer.credit") {
        console.log(`✅ ${BANK_ID} credit`, data);
        //Ejecutar logica de acreditacion de fondos
        //exitoso
        socket.emit("event", { type: "transfer.credit.result", data: { id: data.id, ok: true } });
        //erroneo
        //socket.emit("event", { type: "transfer.credit.result", data: { id: data.id, ok: false,  reason: "CREDIT_FAILED"} });
    }

    if (type === "transfer.debit") {
        console.log(`✅ ${BANK_ID} debit`, data);
        //Ejecutar logica de acreditacion de fondos
        //exitoso
        socket.emit("event", { type: "transfer.debit.result", data: { id: data.id, ok: true } });
        //erroneo
        //socket.emit("event", { type: "transfer.debit.result", data: { id: data.id, ok: false,  reason: "DEBIT_FAILED"} });
    }

    if (type === "transfer.rollback") {
        //Ejecutar logica de rollback
        console.log(`↩️ ${BANK_ID} rollback`, data);
    }

    if (type === "transfer.reject") {
        console.log(`⛔ ${BANK_ID} reject`, data);
    }

    if (type === "transfer.commit") {
        //transaccion finalizada correctamente
        console.log(`✅ ${BANK_ID} commit`, data);
    }

});

socket.on("connect_error", (e) => console.error("connect_error", e.message));
socket.on("disconnect", () => console.log(`🔌 ${BANK_ID} desconectado`));
