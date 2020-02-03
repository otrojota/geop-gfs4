const {ProveedorCapas, Origen, CapaRaster} = require("geop-base-proveedor-capas");
const config = require("./Config").getConfig();
const variables = require("./Variables");
const moment = require("moment-timezone");
const gdal = require("./GDAL");
const fs = require("fs").promises;

class ProveedorCapasGFS4 extends ProveedorCapas {
    constructor(opciones) {
        super("gfs4", opciones);
        this.addOrigen("noaa", "NOAA", "https://www.noaa.gov/", "./img/noaa.png");
        Object.keys(config.variablesPorBanda).forEach(codGFS => {
            let variableGFS = config.variablesPorBanda[codGFS];
            variableGFS.forEach(variable => {
                this.addCapa(new CapaRaster("noaa", variable.codigo, variable.nombre, "noaa", {
                        formatos:{
                            isolineas:true, isobandas:true, serieTiempo:true, valorEnPunto:true
                        },
                        decimales:variable.decimales !== undefined?variable.decimales:2
                    }, variable.grupos, variable.icono, variable.unidad, variable.niveles, variable.nivelInicial
                ))    
            })
        });
        setInterval(_ => this.eliminaArchivosPublicados(), 60000);
        this.eliminaArchivosPublicados();
    }

    async eliminaArchivosPublicados() {
        try {
            let dir = await fs.readdir(config.publishPath);
            let ahora = new Date().getTime();
            let limite = ahora - 60 * 1000;
            for (let i=0; i<dir.length; i++) {
                let path = config.publishPath + "/" + dir[i];
                let stats = await fs.stat(path);
                let t = stats.mtimeMs;
                if (t < limite) {
                    try {
                        await fs.unlink(path);
                    } catch(err) {}
                }
            }
        } catch(error) {
            console.error(error);
        }
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
            /*
            setTimeout(_ => fs.unlink(outPath, err => {
                if (err) console.error("Error eliminando", outPath);                
            }), 10000);  
            */
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
            } else if (formato == "serieTiempo") {
                return await this.generaSerieTiempo(args);
            } else throw "Formato " + args.formato + " no soportado";
        } catch(error) {
            throw error;
        }
    }

    generaIsolineas(args) {
        try {
            let srcFile = config.publishPath + "/" + args.tmpFileName;
            //let dstFile = srcFile + ".isocurvas.geojson";
            let dstFile = srcFile + ".isocurvas.shp";
            let increment = args.incremento;
            return new Promise((resolve, reject) => {
                gdal.isolineas(srcFile, dstFile, increment)
                    .then(_ => {
                        resolve({fileName:args.tmpFileName + ".isocurvas.shp"});
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
            let dstFile = srcFile + ".isobandas.shp";
            let increment = args.incremento;
            return new Promise((resolve, reject) => {
                gdal.isobandas(srcFile, dstFile, increment)
                    .then(_ => {
                        resolve({fileName:args.tmpFileName + ".isobandas.shp"});
                    })
                    .catch(err => reject(err));
            });
        } catch(error) {
            throw error;
        }
    }

    async generaSerieTiempo(args) {
        try {
            let capa = this.getCapa(args.codigoVariable);
            if (!capa) throw "No se encontró la variable '" + args.codigoVariable + "'";
            let levelIndex = 0;
            if (args.levelIndex) levelIndex = args.levelIndex;

            let lat = args.lat;
            let lng = args.lng;
            let time0 = variables.normalizaTiempo(args.time0);
            let time1 = variables.normalizaTiempo(args.time1);

            let puntosPendientes = [], puntosPendientes2 = [];
            let time = time0.clone();
            while (!time.isAfter(time1)) {
                let metadata = await variables.getMetadata(time);
                if (metadata) {
                    if (args.codigoVariable == "VIENTO_10m" || args.codigoVariable == "VIENTO") {
                        let codigoVariable1, codigoVariable2;
                        if (args.codigoVariable == "VIENTO_10m") {                            
                            codigoVariable1 = "UGRD_10M-0";
                            codigoVariable2 = "VGRD_10M-0";
                        } else {
                            codigoVariable1 = "UGRD_HP-" + levelIndex;
                            codigoVariable2 = "VGRD_HP-" + levelIndex;
                        }
                        let varMetadata1 = metadata.variables[codigoVariable1];
                        let varMetadata2 = metadata.variables[codigoVariable2];
                        if (varMetadata1 && varMetadata2) {
                            let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                            puntosPendientes.push({time:time.valueOf(), lng:lng, lat:lat, path:path, banda:varMetadata1.banda, tmpPath:config.dataPath + "/tmp", metadata:varMetadata1})
                            puntosPendientes2.push({time:time.valueOf(), lng:lng, lat:lat, path:path, banda:varMetadata2.banda, tmpPath:config.dataPath + "/tmp", metadata:varMetadata2})
                        }
                    } else {
                        let varMetadata = metadata.variables[args.codigoVariable + "-" + levelIndex];
                        if (varMetadata) {
                            let banda = varMetadata.banda;
                            let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                            puntosPendientes.push({time:time.valueOf(), lng:lng, lat:lat, path:path, banda:banda, tmpPath:config.dataPath + "/tmp", metadata:varMetadata})
                        }
                    }
                }
                time = time.add(3, "hours");
            }
            let ret = {
                lat:lat, lng:lng,
                time0:time0.valueOf(), time1:time1.valueOf(), levelIndex:levelIndex
            }  
            if (!puntosPendientes.length) {
                ret.data = [];
                ret.unit = variables.units[args.codigoVariable];
                return ret;
            }  
            if (args.codigoVariable == "VIENTO_10m" || args.codigoVariable == "VIENTO") {
                ret.unit = "m/s";
                let u = await this.getPuntosTimeSerieEnParalelo(puntosPendientes, 5);
                let v = await this.getPuntosTimeSerieEnParalelo(puntosPendientes2, 5);
                ret.data = [];
                for (let i=0; i<u.length; i++) {
                    ret.data.push({
                        metadata:v[i].metadata, time:v[i].time,
                        value:Math.sqrt(Math.pow(u[i].value, 2) + Math.pow(v[i].value,2))
                    });
                }
            } else {
                ret.unit = variables.units[args.codigoVariable];
                let puntos = await this.getPuntosTimeSerieEnParalelo(puntosPendientes, 10);
                ret.data = puntos;
            }
            return ret;
        } catch(error) {
            throw error;
        }
    }

    getPuntosTimeSerieEnParalelo(puntosPendientes, nHebras) {
        return new Promise((resolve, reject) => {
            let control = {nPendientesTermino:puntosPendientes.length, resolve:resolve, reject:reject};
            let puntos = [];
            let i=0; 
            while (i<nHebras && puntosPendientes.length) {
                this.iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntos, control);
                i++;
            }
        });
    }
    iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntosAgregados, control) {
        if (puntosPendientes.length) {
            let args = puntosPendientes[0];
            puntosPendientes.splice(0,1);
            gdal.getPointValue(args.lng, args.lat, args.path, args.banda, args.tmpPath)
                .then(punto => {
                    puntosAgregados.push({time:args.time, value:punto, metadata:args.metadata});
                    control.nPendientesTermino--;
                    this.iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntosAgregados, control);
                })
                .catch(error => {
                    control.nPendientesTermino--;
                    this.iniciaExtraccionSiguientePuntoSerieTiempo(puntosPendientes, puntosAgregados, control);
                });            
        } else {
            if (!control.nPendientesTermino) {
                puntosAgregados.sort((p0, p1) => (p0.time - p1.time));
                control.resolve(puntosAgregados);
            }
        }
    }
}

module.exports = ProveedorCapasGFS4;