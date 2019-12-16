const {ProveedorCapas, Origen, CapaRaster} = require("geop-base-proveedor-capas");
const config = require("./Config").getConfig();
const variables = require("./Variables");

class ProveedorCapasGFS4 extends ProveedorCapas {
    constructor(opciones) {
        super("gfs4", opciones);
        this.addOrigen("noaa", "NOAA", "https://www.noaa.gov/", "./img/noaa.png");
        Object.keys(config.variablesPorBanda).forEach(codGFS => {
            let variableGFS = config.variablesPorBanda[codGFS];
            variableGFS.forEach(variable => {
                this.addCapa(new CapaRaster("noaa", variable.codigo, variable.nombre, "noaa", {
                        formatos:{
                            isolineas:true
                        }
                    }, variable.grupos, variable.icono, variable.unidad, variable.niveles, variable.nivelInicial
                ))    
            })
        });
    }

    normalizaBBox(lng0, lat0, lng1, lat1) {
        let _lng0 = 0.125 * parseInt(lng0 / 0.125);
        let _lat0 = 0.125 * parseInt(lat0 / 0.125);
        let _lng1 = 0.125 * parseInt(lng1 / 0.125);
        if (_lng1 != lng1) _lng1 += 0.125;
        let _lat1 = 0.125 * parseInt(lat1 / 0.125);
        if (_lat1 != lat1) _lat1 += 0.125;
        let limites = config.limites;
        if (_lng0 < limites.w) _lng0 = limites.w;
        if (_lng0 > limites.e) _lng0 = limites.e;
        if (_lng1 < limites.w) _lng1 = limites.w;
        if (_lng1 > limites.e) _lng1 = limites.e;
        if (_lat0 < limites.s) _lat0 = limites.s;
        if (_lat0 > limites.n) _lat0 = limites.n;
        if (_lat1 < limites.s) _lat1 = limites.s;
        if (_lat1 > limites.n) _lat1 = limites.n;
        return {lng0:_lng0, lat0:_lat0, lng1:_lng1, lat1:_lat1};
    }

    async getPreconsulta(codigoCapa, lng0, lat0, lng1, lat1, tiempo, nivel) {
        let capa = this.getCapa(codigoCapa);
        if (!capa) throw "No se encontró la capa '" + codigoCapa + "'";
        let metadata = await variables.findMetadata(tiempo, codigoCapa, nivel);
        if (!metadata) throw "No hay datos";
        let varMetadata = metadata.variables[codigoCapa + "-" + nivel];
        let ret = {
            minGlobal:varMetadata.min,
            maxGlobal:varMetadata.max,
            atributos:{
                modelo:varMetadata.modelo
            }
        }
        if (varMetadata.noDataValue) ret.noDataValue = varMetadata.noDataValue;
        let bbox = this.normalizaBBox(lng0, lat0, lng1, lat1);
        if (bbox.lng0 == bbox.lng1 || bbox.lat0 == bbox.lat1) throw "Área sin Datos";
        
        console.log("capa", capa, "metadata", metadata, bbox);
        return ret;
    }
}

module.exports = ProveedorCapasGFS4;