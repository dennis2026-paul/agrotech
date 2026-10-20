// ==================================================
// CONFIGURACIÓN (Firebase)
// ==================================================
const FIREBASE_URL = "https://agrotech-d5f89-default-rtdb.firebaseio.com"; // sin "/" al final
const API_KEY = "AIzaSyDYLxu26AOSLFJBYFQ31KdGjqQUGpx9KdE"; // Configuración del proyecto > General > Clave de API web

const INTERVALO = 3000;           // lectura en vivo (datos actuales)
const INTERVALO_LENTO = 30000;    // historial, alertas y acciones
const TIEMPO_DESCONEXION = 30000; // sin datos nuevos en 30 s => desconectado

const $ = (id) => document.getElementById(id);

const temperatura = $("temperatura");
const humedad = $("humedad");
const suelo = $("suelo");
const cubierta = $("cubierta");
const conexion = $("conexion");
const estadoConexion = $("estadoConexion");
const invernadero = $("invernadero");
const tablaDatos = $("tablaDatos");
const aviso = $("aviso");
const chkAuto = $("chkAuto");

const btnAbrir = $("btnAbrir");
const btnCerrar = $("btnCerrar");
const btnBombaOn = $("btnBombaOn");
const btnBombaOff = $("btnBombaOff");

const pantallaLogin = $("pantallaLogin");
const app = $("app");
const formLogin = $("formLogin");
const errorLogin = $("errorLogin");
const btnEntrar = $("btnEntrar");
const btnSalir = $("btnSalir");

let ultimo = null;
let sesion = null;   // { idToken, refreshToken, expira }
let temporizador = null;
let temporizadorLento = null;


// ==================================================
// SESIÓN (Firebase Authentication)
// ==================================================

function guardarSesion(idToken, refreshToken, segundos) {
    sesion = {
        idToken: idToken,
        refreshToken: refreshToken,
        expira: Date.now() + (Number(segundos) - 60) * 1000
    };
    localStorage.setItem("agrotech_refresh", refreshToken);
}

function mensajeError(codigo) {
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND|INVALID_EMAIL/.test(codigo)) {
        return "Correo o contraseña incorrectos.";
    }
    if (/TOO_MANY_ATTEMPTS/.test(codigo)) return "Demasiados intentos. Espera unos minutos.";
    if (/USER_DISABLED/.test(codigo)) return "Esta cuenta está desactivada.";
    return "No se pudo iniciar sesión. Revisa tu conexión.";
}

async function iniciarSesion(correo, clave) {
    const url = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY;
    const respuesta = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: correo, password: clave, returnSecureToken: true })
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(mensajeError((datos.error && datos.error.message) || ""));

    guardarSesion(datos.idToken, datos.refreshToken, datos.expiresIn);
}

async function renovarSesion() {
    const url = "https://securetoken.googleapis.com/v1/token?key=" + API_KEY;
    const respuesta = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(sesion.refreshToken)
    });
    if (!respuesta.ok) throw new Error("Sesión vencida");

    const datos = await respuesta.json();
    guardarSesion(datos.id_token, datos.refresh_token, datos.expires_in);
}

async function tokenValido() {
    if (!sesion) throw new Error("Sin sesión");
    if (Date.now() > sesion.expira) await renovarSesion();
    return sesion.idToken;
}

function mostrarLogin() {
    clearInterval(temporizador);
    clearInterval(temporizadorLento);
    temporizador = null;
    temporizadorLento = null;
    sesion = null;
    ultimo = null;
    localStorage.removeItem("agrotech_refresh");

    app.hidden = true;
    pantallaLogin.hidden = false;
    $("clave").value = "";
}

function mostrarApp() {
    pantallaLogin.hidden = true;
    app.hidden = false;
    errorLogin.textContent = "";

    crearGraficas();
    actualizar();
    cargarRegistros();
    temporizador = setInterval(actualizar, INTERVALO);
    temporizadorLento = setInterval(cargarRegistros, INTERVALO_LENTO);
}


// ==================================================
// BASE DE DATOS
// ==================================================


async function api(ruta, metodo = "GET", cuerpo) {
    const token = await tokenValido();
    const separador = ruta.includes("?") ? "&" : "?";

    const url = FIREBASE_URL + ruta +
        separador + "auth=" + encodeURIComponent(token);

    const opciones = {
        method: metodo,
        headers: {
            "Content-Type": "application/json"
        }
    };

    if (cuerpo !== undefined) {
        opciones.body = JSON.stringify(cuerpo);
    }

    const respuesta = await fetch(url, opciones);

    if (respuesta.status === 401 || respuesta.status === 403) {
        mostrarLogin();
        errorLogin.textContent =
            "Tu sesión terminó o no tienes permiso. Inicia sesión otra vez.";
        throw new Error("Sin permiso");
    }

    if (!respuesta.ok) {
        const detalle = await respuesta.text();
        throw new Error(
            "Error " + respuesta.status + ": " + detalle
        );
    }

    return respuesta.json();
}

async function enviarComando(datos, mensaje) {
    try {
        await api("/comandos.json", "PATCH", datos);

        aviso.textContent = mensaje ||
            "Comando enviado. El ESP32 lo ejecuta en unos segundos.";
    } catch (e) {
        console.error("Error al enviar comando:", e);

        aviso.textContent =
            "No se pudo enviar el comando. Revisa la conexión y los permisos.";
    }
}



// ==================================================
// PANTALLA
// ==================================================

function barra(id, porcentaje) {
    $(id).style.width = Math.max(0, Math.min(100, porcentaje)) + "%";
}

function pintar(d) {
    ultimo = d;

    const conectado = d.ts && (Date.now() - d.ts) < TIEMPO_DESCONEXION;
    conexion.textContent = conectado ? "Conectado" : "Desconectado";
    estadoConexion.dataset.estado = conectado ? "on" : "off";

    $("bannerDesc").hidden = conectado;
    if (!conectado) {
        $("textoDesc").textContent = "⚠️ El ESP32 no envía datos" +
            (d.ts ? " desde hace " + hace(Date.now() - d.ts) : "") + ". Revisa la energía y el WiFi.";
    }

    temperatura.textContent = d.temperatura != null ? d.temperatura + " °C" : "-- °C";
    humedad.textContent = d.humedad != null ? d.humedad + " %" : "-- %";
    suelo.textContent = d.sueloPct != null ? d.sueloPct + " %" : "-- %";

    barra("barraTemp", ((d.temperatura ?? 10) - 10) / 35 * 100);
    barra("barraHum", d.humedad ?? 0);
    barra("barraSuelo", d.sueloPct ?? 0);

    $("lluvia").textContent = d.lluvia ? "Sí" : "No";
    $("sol").textContent = d.sol ? "Sí" : "No";
    $("bomba").textContent = d.bomba === "on" ? "Encendido" : "Apagado";

    const cerrada = d.techo === "cerrado";
    cubierta.textContent = cerrada ? "Cerrada" : "Abierta";
    invernadero.classList.toggle("abierta", !cerrada);

    const auto = d.modo !== "manual";
    chkAuto.checked = auto;

    // En modo automático los botones manuales se desactivan
    btnAbrir.disabled = auto || !cerrada;
    btnCerrar.disabled = auto || cerrada;
    btnBombaOn.disabled = auto || d.bomba === "on";
    btnBombaOff.disabled = auto || d.bomba !== "on";
}

function fila(d) {
    const fecha = new Date(d.ts);
    const celdas = [
        ["Fecha", fecha.toLocaleDateString("es-EC")],
        ["Hora", fecha.toLocaleTimeString("es-EC")],
        ["Temperatura", d.temperatura != null ? d.temperatura + " °C" : "--"],
        ["Humedad", d.humedad != null ? d.humedad + " %" : "--"],
        ["Suelo", d.sueloPct != null ? d.sueloPct + " %" : "--"],
        ["Cubierta", d.techo === "cerrado" ? "Cerrada" : "Abierta"],
        ["Riego", d.bomba === "on" ? "Encendido" : "Apagado"]
    ];

    const tr = document.createElement("tr");
    celdas.forEach(function (c) {
        const td = document.createElement("td");
        td.dataset.label = c[0];
        td.textContent = c[1];
        tr.appendChild(td);
    });
    return tr;
}

function hace(ms) {
    const min = Math.floor(ms / 60000);
    if (min < 1) return "menos de 1 minuto";
    if (min < 60) return min + " min";
    const horas = Math.floor(min / 60);
    return horas < 24 ? horas + " h" : Math.floor(horas / 24) + " días";
}


// ==================================================
// HISTORIAL, GRÁFICAS Y RESUMEN
// ==================================================

let registros = [];   // del más viejo al más nuevo
let graficaAire = null;
let graficaSuelo = null;

function crearGraficas() {
    if (typeof Chart === "undefined" || graficaAire) return;
    Chart.defaults.font.family = '"Bricolage Grotesque", system-ui, sans-serif';

    const base = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { position: "bottom" } }
    };

    graficaAire = new Chart($("gAire"), {
        type: "line",
        data: {
            labels: [],
            datasets: [
                { label: "Temperatura (°C)", data: [], borderColor: "#e0a21c", backgroundColor: "#e0a21c", yAxisID: "y", tension: 0.3, pointRadius: 0 },
                { label: "Humedad del aire (%)", data: [], borderColor: "#2f86c7", backgroundColor: "#2f86c7", yAxisID: "y1", tension: 0.3, pointRadius: 0 }
            ]
        },
        options: Object.assign({}, base, {
            scales: {
                y: { title: { display: true, text: "°C" } },
                y1: { position: "right", min: 0, max: 100, grid: { drawOnChartArea: false }, title: { display: true, text: "%" } }
            }
        })
    });

    graficaSuelo = new Chart($("gSuelo"), {
        type: "line",
        data: {
            labels: [],
            datasets: [{ label: "Humedad del suelo (%)", data: [], borderColor: "#2f9e5f", backgroundColor: "rgba(47,158,95,.15)", fill: true, tension: 0.3, pointRadius: 0 }]
        },
        options: Object.assign({}, base, {
            scales: { y: { min: 0, max: 100, title: { display: true, text: "%" } } }
        })
    });
}

function pintarGraficas() {
    if (!graficaAire) return;

    const horas = registros.map((d) => new Date(d.ts).toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" }));

    graficaAire.data.labels = horas;
    graficaAire.data.datasets[0].data = registros.map((d) => d.temperatura ?? null);
    graficaAire.data.datasets[1].data = registros.map((d) => d.humedad ?? null);
    graficaAire.update("none");

    graficaSuelo.data.labels = horas;
    graficaSuelo.data.datasets[0].data = registros.map((d) => d.sueloPct ?? null);
    graficaSuelo.update("none");
}

function promedio(valores) {
    const v = valores.filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function porcentaje(condicion) {
    return Math.round(registros.filter(condicion).length / registros.length * 100);
}

function pintarResumen() {
    const cont = $("resumen");
    if (registros.length === 0) return;

    const temp = promedio(registros.map((d) => d.temperatura));
    const sue = promedio(registros.map((d) => d.sueloPct));

    const items = [
        { clase: "temp", titulo: "Temperatura promedio", texto: temp != null ? temp.toFixed(1) + " °C" : "--", pct: temp != null ? (temp - 10) / 35 * 100 : 0 },
        { clase: "", titulo: "Humedad del suelo promedio", texto: sue != null ? Math.round(sue) + " %" : "--", pct: sue ?? 0 },
        { clase: "hum", titulo: "Tiempo con riego encendido", texto: porcentaje((d) => d.bomba === "on") + " %", pct: porcentaje((d) => d.bomba === "on") },
        { clase: "", titulo: "Tiempo con cubierta abierta", texto: porcentaje((d) => d.techo !== "cerrado") + " %", pct: porcentaje((d) => d.techo !== "cerrado") },
        { clase: "hum", titulo: "Tiempo con lluvia", texto: porcentaje((d) => d.lluvia) + " %", pct: porcentaje((d) => d.lluvia) },
        { clase: "temp", titulo: "Tiempo con sol", texto: porcentaje((d) => d.sol) + " %", pct: porcentaje((d) => d.sol) }
    ];

    $("resumenTitulo").textContent = "Resumen de los últimos " + registros.length + " registros";

    cont.replaceChildren(...items.map(function (it) {
        const tile = document.createElement("div");
        tile.className = "tile " + it.clase;

        const titulo = document.createElement("small");
        titulo.textContent = it.titulo;
        const valor = document.createElement("strong");
        valor.textContent = it.texto;
        const barraEl = document.createElement("div");
        barraEl.className = "barra";
        const relleno = document.createElement("span");
        relleno.style.width = Math.max(0, Math.min(100, it.pct)) + "%";
        barraEl.appendChild(relleno);

        tile.append(titulo, valor, barraEl);
        return tile;
    }));
}

function pintarHistorial(datos) {
    registros = Object.values(datos || {}).filter((d) => d.ts).sort((a, b) => a.ts - b.ts);
    if (registros.length === 0) return;

    tablaDatos.replaceChildren(...registros.slice(-10).reverse().map(fila));
    pintarGraficas();
    pintarResumen();
}

function descargarCSV() {
    if (registros.length === 0) return;

    const filas = ["fecha,hora,temperatura_c,humedad_aire_pct,suelo_pct,suelo_crudo,lluvia,sol,cubierta,riego,modo"];
    registros.forEach(function (d) {
        const f = new Date(d.ts);
        filas.push([
            f.toLocaleDateString("es-EC"), f.toLocaleTimeString("es-EC"),
            d.temperatura ?? "", d.humedad ?? "", d.sueloPct ?? "", d.suelo ?? "",
            d.lluvia ? "si" : "no", d.sol ? "si" : "no",
            d.techo ?? "", d.bomba === "on" ? "encendido" : "apagado", d.modo ?? ""
        ].join(","));
    });

    const archivo = new Blob(["\ufeff" + filas.join("\n")], { type: "text/csv;charset=utf-8" });
    const enlace = document.createElement("a");
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = "agrotech_historial.csv";
    enlace.click();
    URL.revokeObjectURL(enlace.href);
}


// ==================================================
// ALERTAS Y ACCIONES
// ==================================================

const CLAVE_VISTAS = "agrotech_alertas_vistas";
const notificadas = new Set();
let ultimaAlertaTs = 0;

function itemEvento(icono, titulo, detalle, ts, nivel) {
    const li = document.createElement("li");
    li.className = "evento" + (nivel ? " " + nivel : "");

    const ic = document.createElement("span");
    ic.textContent = icono;

    const cuerpo = document.createElement("div");
    const t = document.createElement("strong");
    t.textContent = titulo;
    cuerpo.appendChild(t);
    if (detalle) {
        const d = document.createElement("span");
        d.textContent = detalle;
        cuerpo.appendChild(d);
    }
    const h = document.createElement("time");
    h.textContent = new Date(ts).toLocaleString("es-EC", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    cuerpo.appendChild(h);

    li.append(ic, cuerpo);
    return li;
}

function notificar(alerta) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification("AgroTech", { body: alerta.mensaje });
}

function pintarAlertas(datos) {
    const lista = Object.values(datos || {}).filter((a) => a.ts).sort((a, b) => b.ts - a.ts);
    const iconos = { peligro: "🔴", aviso: "🟠", info: "🔵" };

    $("listaAlertas").replaceChildren(...(lista.length
        ? lista.map((a) => itemEvento(iconos[a.nivel] || "🔵", a.mensaje, "", a.ts, a.nivel))
        : [Object.assign(document.createElement("li"), { className: "vacio", textContent: "Sin alertas." })]));

    ultimaAlertaTs = lista.length ? lista[0].ts : 0;

    // Alertas nuevas desde la última vez que se marcaron como vistas
    let vistas = Number(localStorage.getItem(CLAVE_VISTAS));
    if (!vistas) {
        vistas = Date.now();
        localStorage.setItem(CLAVE_VISTAS, vistas);
    }

    const nuevas = lista.filter((a) => a.ts > vistas);
    $("bannerAlerta").hidden = nuevas.length === 0;

    if (nuevas.length > 0) {
        $("textoBanner").textContent = (nuevas.length === 1 ? "Alerta nueva: " : nuevas.length + " alertas nuevas. La última: ") + nuevas[0].mensaje;
        nuevas.forEach(function (a) {
            if (!notificadas.has(a.ts)) {
                notificadas.add(a.ts);
                notificar(a);
            }
        });
    }
}

function pintarAcciones(datos) {
    const lista = Object.values(datos || {}).filter((a) => a.ts).sort((a, b) => b.ts - a.ts);

    $("listaAcciones").replaceChildren(...(lista.length
        ? lista.map((a) => itemEvento("⚙️", a.accion, (a.motivo || "") + (a.modo === "manual" ? " (manual)" : ""), a.ts, ""))
        : [Object.assign(document.createElement("li"), { className: "vacio", textContent: "Sin acciones registradas." })]));
}

function estadoBotonNotificar() {
    const boton = $("btnNotificar");
    const disponible = "Notification" in window && window.isSecureContext && Notification.permission === "default";
    boton.hidden = !disponible;
}


// ==================================================
// ACTUALIZACIÓN
// ==================================================

// Datos en vivo (liviano, cada 3 s)
async function actualizar() {
    try {
        const actual = await api("/actual.json");
        if (actual) pintar(actual);
        else conexion.textContent = "Sin datos";
    } catch (e) {
        if (!sesion) return;   // se cerró la sesión, no hay nada que mostrar
        conexion.textContent = "Sin conexión a la base de datos";
        estadoConexion.dataset.estado = "off";
    }
}

// Historial, alertas y acciones (más pesado, cada 30 s)
async function cargarRegistros() {
    const filtro = (cantidad) => "?orderBy=" + encodeURIComponent('"$key"') + "&limitToLast=" + cantidad;
    const cantidad = Number($("cantidad").value) || 60;

    try {
        await tokenValido();
        const [historial, alertas, acciones] = await Promise.all([
            api("/historial.json" + filtro(cantidad)),
            api("/alertas.json" + filtro(10)),
            api("/acciones.json" + filtro(10))
        ]);
        pintarHistorial(historial);
        pintarAlertas(alertas);
        pintarAcciones(acciones);
    } catch (e) { /* se reintenta en el siguiente ciclo */ }
    estadoBotonNotificar();
}


// ==================================================
// EVENTOS
// ==================================================

formLogin.addEventListener("submit", async function (e) {
    e.preventDefault();
    errorLogin.textContent = "";
    btnEntrar.disabled = true;
    btnEntrar.textContent = "Entrando...";

    try {
        await iniciarSesion($("correo").value.trim(), $("clave").value);
        mostrarApp();
    } catch (error) {
        errorLogin.textContent = error.message;
    }

    btnEntrar.disabled = false;
    btnEntrar.textContent = "Iniciar sesión";
});

btnSalir.addEventListener("click", mostrarLogin);

btnAbrir.addEventListener("click", () => enviarComando({ techo: "abierto" }));
btnCerrar.addEventListener("click", () => enviarComando({ techo: "cerrado" }));
btnBombaOn.addEventListener("click", () => enviarComando({ bomba: "on" }));
btnBombaOff.addEventListener("click", () => enviarComando({ bomba: "off" }));

chkAuto.addEventListener("change", function () {
    if (chkAuto.checked) {
        enviarComando({ modo: "auto" }, "Modo automático activado.");
    } else {
        // Al pasar a manual, se mantiene el estado actual de techo y riego
        enviarComando({
            modo: "manual",
            techo: ultimo ? ultimo.techo : "abierto",
            bomba: ultimo ? ultimo.bomba : "off"
        }, "Modo manual activado. Ya puedes usar los botones.");
    }
});


$("cantidad").addEventListener("change", cargarRegistros);
$("btnCSV").addEventListener("click", descargarCSV);

$("btnVistas").addEventListener("click", function () {
    localStorage.setItem(CLAVE_VISTAS, Math.max(ultimaAlertaTs, Date.now()));
    $("bannerAlerta").hidden = true;
});

$("btnNotificar").addEventListener("click", async function () {
    await Notification.requestPermission();
    estadoBotonNotificar();
});


// ==================================================
// INICIO
// ==================================================

[btnAbrir, btnCerrar, btnBombaOn, btnBombaOff].forEach((b) => (b.disabled = true));

async function iniciar() {
    if (FIREBASE_URL.includes("TU-PROYECTO") || API_KEY.includes("TU_API_KEY")) {
        mostrarLogin();
        errorLogin.textContent = "Falta configurar FIREBASE_URL y API_KEY en js/app.js.";
        return;
    }

    // Si ya había una sesión guardada, se recupera sin pedir la contraseña
    const guardado = localStorage.getItem("agrotech_refresh");
    if (guardado) {
        sesion = { refreshToken: guardado, expira: 0 };
        try {
            await renovarSesion();
            mostrarApp();
            return;
        } catch (e) { /* sesión vencida: se pide el login */ }
    }
    mostrarLogin();
}

iniciar();