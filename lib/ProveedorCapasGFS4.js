const {ProveedorCapas, Origen, CapaRaster} = require("geop-base-proveedor-capas");

class ProveedorCapasGFS4 extends ProveedorCapas {
    constructor(opciones) {
        super("gfs4", opciones);
        this.addOrigen("noaa", "NOAA", "https://www.noaa.gov/", "./img/noaa.png");
    }
}

module.exports = ProveedorCapasGFS4;