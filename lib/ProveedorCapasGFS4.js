const {ProveedorCapas, Origen, CapaRaster} = require("geop-base-proveedor-capas");

const config = require("./Config").getConfig();
class ProveedorCapasGFS4 extends ProveedorCapas {
    constructor(opciones) {
        super("gfs4", opciones);
        this.addOrigen("noaa", "NOAA", "https://www.noaa.gov/", "./img/noaa.png");
        Object.keys(config.variablesPorBanda).forEach(codGFS => {
            let variableGFS = config.variablesPorBanda[codGFS];
            variableGFS.forEach(variable => {
                this.addCapa(new CapaRaster("noaa", variable.codigo, variable.nombre, {
                    formatos:{
                        isolineas:true
                    },
                    grupos:variable.grupos,
                    unidad:variable.unidad,
                    niveles:variable.niveles,
                    nivelInicial:variable.nivelInicial
                }))    
            })
        });
    }    
}

module.exports = ProveedorCapasGFS4;