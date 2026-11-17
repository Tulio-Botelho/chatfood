// Estado e obtenção da localização. Só pede permissão ao navegador após clique do usuário.
let current = null;
const listeners = [];

export const getLocation = () => current;
export const onLocationChange = (fn) => listeners.push(fn);

export function setLocation(loc) {
  current = loc ? { lat: loc.lat, lon: loc.lon, label: loc.label || null, source: loc.source } : null;
  listeners.forEach((fn) => fn(current));
}

export function requestBrowserLocation() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(Object.assign(new Error("unsupported"), { code: "unsupported" }));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Minha localização", source: "browser" }),
      (err) => reject(Object.assign(new Error(err.message), { code: err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable" })),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}

export const LOCATION_ERRORS = {
  denied: "Você negou o acesso à localização. Informe um bairro, cidade ou endereço abaixo.",
  unsupported: "Seu navegador não suporta geolocalização. Informe um endereço abaixo.",
  timeout: "Não consegui obter sua localização a tempo. Tente de novo ou informe um endereço.",
  unavailable: "Localização indisponível. Informe um bairro, cidade ou endereço.",
};
