const {ProveedorCapas, Origen, CapaRaster} = require("geop-base-proveedor-capas");
const config = require("./Config").getConfig();
const variables = require("./Variables");
const moment = require("moment-timezone");
const gdal = require("./GDAL");
const fs = require("fs");

class ProveedorCapasGFS4 extends ProveedorCapas {
    constructor(opciones) {
        super("gfs4", opciones);
        this.addOrigen("noaa", "NOAA", "https://www.noaa.gov/", "./img/noaa.png");
        Object.keys(config.variablesPorBanda).forEach(codGFS => {
            let variableGFS = config.variablesPorBanda[codGFS];
            variableGFS.forEach(variable => {
                this.addCapa(new CapaRaster("noaa", variable.codigo, variable.nombre, "noaa", {
                        formatos:{
                            isolineas:true, isobandas:true
                        }
                    }, variable.grupos, variable.icono, variable.unidad, variable.niveles, variable.nivelInicial
                ))    
            })
        });
    }

    getPath(dt) {
        return config.dataPath + "/" + dt.format("YYYY") + "/" + dt.format("MM");
    }
    async getPreconsulta(codigoCapa, lng0, lat0, lng1, lat1, tiempo, nivel) {
        try {
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
            let outFileName = "tmp_" + parseInt(Math.random() * 9999999999) + ".tif";
            let outPath = config.publishPath + "/" + outFileName;
            let dt = moment.tz(metadata.tiempo, "UTC");
            let srcPath = this.getPath(dt) + "/" + dt.format("DD_HH00") + ".grb2";
            let bbox = await variables.exportaTIFF(varMetadata.banda, srcPath, outPath, lng0, lat0, lng1, lat1); 
            setTimeout(_ => fs.unlink(outPath, err => {
                if (err) console.error("Error eliminando", outPath);                
            }), 10000);  
            ret.bbox = bbox;         
            let info = await gdal.info(outPath, true);
            let banda = info.bands[0];
            ret.atributos.descripcionNivelGFS = banda.description;
            ret.atributos.descripcionVariableGFS = banda.metadata.GRIB_COMMENT;
            ret.atributos.disciplinaGFS = banda.metadata.GRIB_DISCIPLINE;
            ret.atributos.unidadGFS = banda.metadata.GRIB_UNIT;
            ret.min = banda.computedMin;
            ret.max = banda.computedMax;
            ret.tmpFileName = outFileName;
            ret.resX = info.size[0];
            ret.resY = info.size[1];
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async resuelveConsulta(formato, args) {
        try {
            if (formato == "isolineas") {
                return await this.generaIsolineas(args);
            } else if (formato == "isobandas") {
                return await this.generaIsobandas(args);
            } else throw "Formato " + args.formato + " no soportado";
        } catch(error) {
            throw error;
        }
    }

    generaIsolineas(args) {
        try {
            let srcFile = config.publishPath + "/" + args.tmpFileName;
            let dstFile = srcFile + ".isocurvas.geojson";
            let increment = args.incremento;
            return new Promise((resolve, reject) => {
                gdal.isolineas(srcFile, dstFile, increment)
                    .then(_ => {
                        fs.readFile(dstFile, {}, (err, data) => {
                            if (err) reject(err);
                            try {
                                let isolineas = JSON.parse(data);
                                fs.unlink(dstFile, err => {
                                    let marcadores = this.generaMarcadores(isolineas);
                                    resolve({isolineas:isolineas, marcadores:marcadores});
                                })
                            } catch(error) {
                                console.error("Error parseando json de isolineas", error, data);
                                reject(error);
                            }
                        });
                    })
                    .catch(err => reject(err));
            });
        } catch(error) {
            throw error;
        }
    }
    generaMarcadores(isolineas) {
        try {
            let ret = [];
            isolineas.features.forEach(f => {
                if (f.geometry.type == "LineString") {
                    let v = Math.round(f.properties.value * 100) / 100;
                    let n = f.geometry.coordinates.length;
                    let med = parseInt((n - 0.1) / 2);
                    let p0 = f.geometry.coordinates[med], p1 = f.geometry.coordinates[med+1];
                    let lng = (p0[0] + p1[0]) / 2;
                    let lat = (p0[1] + p1[1]) / 2;
                    ret.push({lat:lat, lng:lng, value:v});
                }
            });
            return ret;
        } catch(error) {
            console.error(error);
            return [];
        }
    }

    generaIsobandas(args) {
        try {
            let srcFile = config.publishPath + "/" + args.tmpFileName;
            let dstFile = srcFile + ".isobandas.geojson";
            let increment = args.incremento;
            return new Promise((resolve, reject) => {
                gdal.isobandas(srcFile, dstFile, increment)
                    .then(_ => {
                        fs.readFile(dstFile, {}, (err, data) => {
                            if (err) reject(err);
                            try {
                                let isobandas = JSON.parse(data);
                                fs.unlink(dstFile, err => {                                
                                    resolve(isobandas);
                                })
                            } catch(error) {
                                console.error("Error parseando json de isobandas", error, data);
                                reject(error);
                            }
                        });
                    })
                    .catch(err => {
                        console.error(err);
                        reject(err)
                    });
            });
        } catch(error) {
            throw error;
        }
    }
}

module.exports = ProveedorCapasGFS4;