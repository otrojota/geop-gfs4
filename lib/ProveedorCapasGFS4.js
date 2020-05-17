const {ProveedorCapas, Origen, CapaRaster} = require("geop-base-proveedor-capas");
const config = require("./Config").getConfig();
const variables = require("./Variables");
const moment = require("moment-timezone");
const gdal = require("./GDAL");
const fsProm = require("fs").promises;
const fs = require("fs");
const PNG = require("pngjs").PNG;
const dbg = require("./Debug");

class ProveedorCapasGFS4 extends ProveedorCapas {
    constructor(opciones) {
        super("gfs4", opciones);
        this.addOrigen("noaa", "NOAA", "https://www.noaa.gov/", "./img/noaa.png");
        Object.keys(config.variablesPorBanda).forEach(codGFS => {
            let variableGFS = config.variablesPorBanda[codGFS];
            variableGFS.forEach(variable => {
                let opciones = {
                    formatos:{
                        isolineas:true, isobandas:true, serieTiempo:true, valorEnPunto:true, matrizRectangular:true
                    },
                    decimales:variable.decimales !== undefined?variable.decimales:2,
                    visualizadoresIniciales:variable.visualizadoresIniciales?variable.visualizadoresIniciales:undefined
                }
                if (variable.opacidad !== undefined) opciones.opacidad = variable.opacidad;
                this.addCapa(
                    new CapaRaster("noaa", variable.codigo, variable.nombre, "noaa", opciones, variable.grupos, variable.icono, variable.unidad, variable.niveles, variable.nivelInicial
                ))    
            })
        });
        // Viento a 10m
        this.addCapa(
            new CapaRaster("noaa", "MAG_GRD_10m", "Viento a 10m", "noaa", {
                magnitudCalculada:{capaU:"UGRD_10M", capaV:"VGRD_10M"},
                formatos:{
                    isolineas:true, isobandas:true, serieTiempo:true, valorEnPunto:true, uv:true, windglPNG:true, matrizRectangular:true
                },
                decimales:2,
                opacidad:100,
                visualizadoresIniciales:{
                    particulas:{
                        nParticulas:5000, 
                        velocidad:0.5,
                        escala:{dinamica:true, nombre:"Magma - MatplotLib"}
                    }
                }
            }, ["meteorologia"], "img/variables/velocidad-viento.svg", "m/s", [{gribShortName:"10-HTGL", descripcion:"10 m"}], 0)
        )
        // Viento por nivel de presión
        this.addCapa(
            new CapaRaster("noaa", "MAG_GRD_HP", "Viento por Capa de Presión", "noaa", {
                magnitudCalculada:{capaU:"UGRD_HP", capaV:"VGRD_HP"},
                formatos:{
                    isolineas:true, isobandas:true, serieTiempo:true, valorEnPunto:true, uv:true, windglPNG:true, matrizRectangular:true
                },
                decimales:2,
                visualizadoresIniciales:{
                    particulas:{
                        nParticulas:5000, 
                        velocidad:0.5,
                        escala:{dinamica:true, nombre:"Magma - MatplotLib"}
                    }
                }
            }, ["meteorologia"], "img/variables/velocidad-viento.svg", "m/s", this.getCapa("UGRD_HP").niveles, this.getCapa("UGRD_HP").nivelInicial)
        )
        setInterval(_ => this.eliminaArchivosPublicados(), 60000);
        this.eliminaArchivosPublicados();
    }

    async comandoGET(cmd, req, res) {
        try {
            switch(cmd) {
                case "fullReindexar":
                    let dp = new (require("./DescargaPronostico"))();
                    await dp.fullReindexar();
                    res.status(200).send("Ok").end();
                    break;
                default: throw "Comando '" + cmd + "' no implementado";
            }
        } catch(error) {
            console.error(error);
            if (typeof error == "string") {
                res.send(error).status(401).end();
            } else {
                res.send("Error Interno").status(500).end();
            }
        }
    }

    async eliminaArchivosPublicados() {
        try {
            let dir = await fsProm.readdir(config.publishPath);
            let ahora = new Date().getTime();
            let limite = ahora - 60 * 1000;
            for (let i=0; i<dir.length; i++) {
                let path = config.publishPath + "/" + dir[i];
                let stats = await fsProm.stat(path);
                let t = stats.mtimeMs;
                if (t < limite) {
                    try {
                        await fsProm.unlink(path);
                    } catch(err) {
                        console.error("Eliminando archivo", err);
                    }
                }
            }
        } catch(error) {
            console.error(error);
        }
    }

    getPath(dt) {
        return config.dataPath + "/" + dt.format("YYYY") + "/" + dt.format("MM");
    }
    normalizaBBox(lng0, lat0, lng1, lat1) {
        let _lng0 = 0.5 * parseInt(lng0 / 0.5) - 0.5;
        let _lat0 = 0.5 * parseInt(lat0 / 0.5) - 0.5;
        let _lng1 = 0.5 * parseInt(lng1 / 0.5) + 0.5;
        let _lat1 = 0.5 * parseInt(lat1 / 0.5) + 0.5;
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

    async getPreconsulta(codigoCapa, lng0, lat0, lng1, lat1, tiempo, nivel, maxWidth, maxHeight) {
        let op = dbg.start(`Preconsulta ${codigoCapa}`);
        try {
            let capa = this.getCapa(codigoCapa);            
            if (!capa) throw "No se encontró la capa '" + codigoCapa + "'";
            if (capa.opciones.magnitudCalculada) {
                return await this.getPreconsultaMagnitudCalculada(capa, lng0, lat0, lng1, lat1, tiempo, nivel);
            }            
            let metadata = await variables.findMetadata(tiempo, codigoCapa, nivel);
            if (!metadata) throw "No hay datos";
            let varMetadata = metadata.variables[codigoCapa + "-" + nivel];
            let ret = {
                minGlobal:varMetadata.min,
                maxGlobal:varMetadata.max,
                atributos:{
                    "Ejecución Modelo":varMetadata.modelo
                },
                errores:[], advertencias:[], mensajes:[]
            }
            if (varMetadata.noDataValue) ret.noDataValue = varMetadata.noDataValue;
            let outFileName = "tmp_" + parseInt(Math.random() * 9999999999) + ".tif";
            let outPath = config.publishPath + "/" + outFileName;
            let dt = moment.tz(metadata.tiempo, "UTC");
            let srcPath = this.getPath(dt) + "/" + dt.format("DD_HH00") + ".grb2";            

            //let bbox = await variables.exportaTIFF(varMetadata.banda, srcPath, outPath, lng0, lat0, lng1, lat1); 
            let bbox = this.normalizaBBox(lng0, lat0, lng1, lat1);
            if (bbox.lng0 == bbox.lng1 || bbox.lat0 == bbox.lat1) throw "Área sin Datos";
            maxWidth = maxWidth || 150;
            maxHeight = maxHeight || 150;
            let res = 0.25, width = undefined, height = undefined;            
            if ((bbox.lng1 - bbox.lng0) / res > maxWidth) {
                width = maxWidth;
                height = (bbox.lat1 - bbox.lat0) / res;
            }
            if ((bbox.lat1 - bbox.lat0) / res > maxHeight) {
                height = maxHeight;
                width = width || (bbox.lng1 - bbox.lng0) / res;
            }
            if (width || height) ret.advertencias.push(`Se han interpolado los datos para restringir los resultados a una matriz de ${width} x ${height} puntos. Para usar los datos originales, consulte por un área más pequeña`);

            await gdal.translateWindow(bbox.lng0, bbox.lat0, bbox.lng1, bbox.lat1, srcPath, outPath, [varMetadata.banda], (width || height)?{width:width, height:height}:null);

            ret.bbox = bbox;         
            let info = await gdal.info(outPath, true);
            let banda = info.bands[0];
            ret.atributos["Nivel"] = banda.description;
            ret.atributos.Tiempo = metadata.tiempo;
            let md = banda.metadata[""];
            if (md) {
                ret.atributos["Variable GFS"] = md.GRIB_COMMENT;
                ret.atributos["Disciplina GFS"] = md.GRIB_DISCIPLINE;
                ret.atributos["Unidad GFS"] = md.GRIB_UNIT;
                ret.atributos["Pronóstico"] = md.GRIB_FORECAST_SECONDS;
            }
            ret.min = banda.computedMin;
            ret.max = banda.computedMax;
            ret.tmpFileName = outFileName;
            ret.resX = info.size[0];
            ret.resY = info.size[1];
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        } finally {
            dbg.end(op);
        }
    }

    async getPreconsultaMagnitudCalculada(capa, lng0, lat0, lng1, lat1, tiempo, nivel) {        
        try {

            let [preconsultaU, preconsultaV] = await Promise.all([
                this.getPreconsulta(capa.opciones.magnitudCalculada.capaU, lng0, lat0, lng1, lat1, tiempo, nivel),
                this.getPreconsulta(capa.opciones.magnitudCalculada.capaV, lng0, lat0, lng1, lat1, tiempo, nivel)
            ]);
            let outFileName = "tmp_" + parseInt(Math.random() * 9999999999) + ".tif";
            let outPath = config.publishPath + "/" + outFileName;
            let inputFileU = config.publishPath + "/" + preconsultaU.tmpFileName;
            let inputFileV = config.publishPath + "/" + preconsultaV.tmpFileName;
            await variables.calculaMagnitud(inputFileU, inputFileV, outPath);
            let info = await gdal.info(outPath, true);
            let atributos = Object.keys(preconsultaU.atributos).reduce((map, att) => {
                if (att == "Tiempo") {
                    map["Tiempo U"] = preconsultaU.atributos["Tiempo"];
                    map["Tiempo V"] = preconsultaV.atributos["Tiempo"];
                } else {
                    let aU = preconsultaU.atributos[att];
                    let aV = preconsultaV.atributos[att];
                    map[att] = "U:" + aU + ", V:" + aV;
                }
                return map;
            }, {});
            let ret = {                
                atributos:atributos,
                bbox:preconsultaU.bbox,
                min:info.bands[0].computedMin,
                max:info.bands[0].computedMax,
                tmpFileName:outFileName,
                mensajes:preconsultaU.mensajes,
                advertencias:preconsultaU.advertencias,
                errores:preconsultaU.errores,                
                resX:info.size[0],
                resY:info.size[1]
            }            
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async resuelveConsulta(formato, args) {
        let op = dbg.start(`Consulta ${formato}`);
        try {
            if (formato == "isolineas") {
                return await this.generaIsolineas(args);
            } else if (formato == "isobandas") {
                return await this.generaIsobandas(args);
            } else if (formato == "serieTiempo") {
                return await this.generaSerieTiempo(args);
            } else if (formato == "valorEnPunto") {
                return await this.generaValorEnPunto(args);
            } else if (formato == "uv") {
                return await this.generaMatrizUV(args);
            } else if (formato == "windglPNG") {
                return await this.generaWindGLPNG(args);
            } else if (formato == "matrizRectangular") {
                return await this.generaMatrizRectangular(args);
            } else throw "Formato " + formato + " no soportado";
        } catch(error) {
            throw error;
        } finally {
            dbg.end(op);
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
            if (capa.opciones.magnitudCalculada) {
                return await this.generaSerieTiempoMagnitudCalculada(args);
            }
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
                    let varMetadata = metadata.variables[args.codigoVariable + "-" + levelIndex];
                    if (varMetadata) {
                        let banda = varMetadata.banda;
                        let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                        varMetadata["Tiempo"] = time.valueOf();
                        puntosPendientes.push({time:time.valueOf(), lng:lng, lat:lat, path:path, banda:banda, tmpPath:config.dataPath + "/tmp", metadata:varMetadata})
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
            ret.unit = variables.units[args.codigoVariable];
            let puntos = await this.getPuntosTimeSerieEnParalelo(puntosPendientes, 10);
            ret.data = puntos;
            return ret;
        } catch(error) {
            throw error;
        }
    }

    async generaSerieTiempoMagnitudCalculada(args) {
        try {
            let capa = this.getCapa(args.codigoVariable);
            let argsU = JSON.parse(JSON.stringify(args)); argsU.codigoVariable = capa.opciones.magnitudCalculada.capaU;
            let argsV = JSON.parse(JSON.stringify(args)); argsV.codigoVariable = capa.opciones.magnitudCalculada.capaV;
            let [serieU, serieV] = await Promise.all([
                this.generaSerieTiempo(argsU),
                this.generaSerieTiempo(argsV)
            ]);

            if (serieU.data.length != serieV.data.length) throw "Componentes U y V inválidos para el período";

            let levelIndex = 0;
            if (args.levelIndex) levelIndex = args.levelIndex;

            let time0 = variables.normalizaTiempo(args.time0);
            let time1 = variables.normalizaTiempo(args.time1);

            let ret = {
                lat:args.lat, lng:args.lng,
                time0:time0.valueOf(), time1:time1.valueOf(), levelIndex:levelIndex,
                data:serieU.data.reduce((lista, punto, i) => {
                    let u = punto.value, v = serieV.data[i].value;
                    if (u !== undefined && v !== undefined) {
                        let atributos = Object.keys(punto.atributos).reduce((map, att) => {
                            if (att == "Tiempo") {
                                map["Tiempo U"] = punto.atributos["Tiempo"];
                                map["Tiempo V"] = serieV.data[i].atributos["Tiempo"];
                            } else {
                                let aU = punto.atributos[att];
                                let aV = serieV.data[i].atributos[att];
                                map[att] = "U:" + aU + ", V:" + aV;
                            }
                            return map;
                        }, {});
                        lista.push({time:punto.time, value:Math.sqrt(u * u + v * v), atributos:atributos});
                    }
                    return lista;
                }, [])
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
            //gdal.getPointValue(args.lng, args.lat, args.path, args.banda, args.tmpPath)
            gdal.getPixelValue(args.lng, args.lat, args.path, args.banda, args.metadata)
                .then(punto => {
                    if (punto.value !== undefined) {
                        let atributos = {
                            "Ejecución Modelo":args.metadata.modelo,
                            "Tiempo":args.metadata.Tiempo
                        }
                        atributos.realLat = punto.realLat;
                        atributos.realLng = punto.realLng;
                        puntosAgregados.push({time:args.time, value:punto.value, atributos:atributos});
                    }
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
    
    async generaValorEnPunto(args) {
        try {
            let capa = this.getCapa(args.codigoVariable);
            if (!capa) throw "No se encontró la variable '" + args.codigoVariable + "'";
            if (capa.opciones.magnitudCalculada) {
                return await this.generaValorEnPuntoMagnitudCalculada(args);
            }
            let levelIndex = 0;
            if (args.levelIndex) levelIndex = args.levelIndex;

            let lat = args.lat;
            let lng = args.lng;
            let time = variables.normalizaTiempo(args.time);
            let metadata = await variables.getMetadata(time);
            if (!metadata) return "S/D";
            let varMetadata = metadata.variables[args.codigoVariable + "-" + levelIndex];
            if (varMetadata) {
                let atributos = {
                    Tiempo:time,
                    "Ejecución Modelo":varMetadata.modelo
                }
                let banda = varMetadata.banda;
                let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                //let punto = await gdal.getPointValue(lng, lat, path, banda, config.dataPath + "/tmp");
                let punto = await gdal.getPixelValue(lng, lat, path, banda, varMetadata);
                if (!punto) return "S/D";
                atributos.realLng = punto.realLng;
                atributos.realLat = punto.realLat;
                if (args.metadataCompleta) {
                    let info = await gdal.info(path, false);
                    let mdBanda = info.bands[banda - 1];                
                    atributos["Nivel"] = mdBanda.description;
                    let md = mdBanda.metadata[""];
                    if (md) {
                        atributos["Variable GFS"] = md.GRIB_COMMENT;
                        atributos["Disciplina GFS"] = md.GRIB_DISCIPLINE;
                        atributos["Unidad GFS"] = md.GRIB_UNIT;
                        atributos["Pronóstico"] = md.GRIB_FORECAST_SECONDS;
                    }
                }
                return {lng:lng, lat:lat, time:time, metadata:varMetadata, value:punto.value, atributos:atributos}
            }
            return "S/D";
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaValorEnPuntoMagnitudCalculada(args) {
        try {
            let capa = this.getCapa(args.codigoVariable);
            let argsU = JSON.parse(JSON.stringify(args)); argsU.codigoVariable = capa.opciones.magnitudCalculada.capaU;
            let argsV = JSON.parse(JSON.stringify(args)); argsV.codigoVariable = capa.opciones.magnitudCalculada.capaV;
            let [puntoU, puntoV] = await Promise.all([
                this.generaValorEnPunto(argsU),
                this.generaValorEnPunto(argsV)
            ]);
            
            if (puntoU.value !== undefined && puntoV.value !== undefined) {
                let levelIndex = 0;
                if (args.levelIndex) levelIndex = args.levelIndex;
                let time = variables.normalizaTiempo(args.time);
                let metadata = await variables.getMetadata(time);
                let varMetadata = metadata.variables[args.codigoVariable + "-" + levelIndex];
                return {
                    lng:args.lng, lat:args.lat, time:time, metadata:varMetadata, value:Math.sqrt(puntoU.value * puntoU.value + puntoV.value * puntoV.value)
                }
            } else {
                throw "Componente U y V no encontrados";
            }
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaMatrizUV(args) {
        try {
            let capa = this.getCapa(args.codigoVariable);
            let argsU = JSON.parse(JSON.stringify(args)); argsU.codigoVariable = capa.opciones.magnitudCalculada.capaU;
            let argsV = JSON.parse(JSON.stringify(args)); argsV.codigoVariable = capa.opciones.magnitudCalculada.capaV;
            let [matrizU, matrizV] = await Promise.all([
                this.generaMatrizRegular(argsU),
                this.generaMatrizRegular(argsV)
            ]);
            if (!matrizU || !matrizV) throw "No hay Datos";
            let b = variables.normalizaBBox(args.lng0, args.lat0, args.lng1, args.lat1);
            let atributos = Object.keys(matrizU.atributos).reduce((map, att) => {
                if (att == "Tiempo") {
                    map["Tiempo U"] = matrizU.atributos["Tiempo"];
                    map["Tiempo V"] = matrizV.atributos["Tiempo"];
                } else {
                    let aU = matrizU.atributos[att];
                    let aV = matrizV.atributos[att];
                    map[att] = "U:" + aU + ", V:" + aV;
                }
                return map;
            }, {});
            let ret = {
                time:variables.normalizaTiempo(args.time).valueOf(),
                lng0:b.lng0, lat0:b.lat0, lng1:b.lng1, lat1:b.lat1,
                deltaLng:(b.lng1 - b.lng0) / args.resolution,
                deltaLat:(b.lat1 - b.lat0) / args.resolution,
                resolution:args.resolution,
                metadataU:matrizU.metadata,
                metadataV:matrizV.metadata,
                atributos:atributos,
                data:matrizU.data.reduce((lista, v, i) => {
                    lista.push(v, matrizV.data[i]);
                    return lista;
                }, [])
            }
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaMatrizRegular(args) {
        try {
            let levelIndex =    0;
            if (args.levelIndex) levelIndex = args.levelIndex;
            let b = variables.normalizaBBox(args.lng0, args.lat0, args.lng1, args.lat1);
            let time = variables.normalizaTiempo(args.time);
            let metadata = await variables.getMetadata(time);
            let varMetadata = metadata?metadata.variables[args.codigoVariable + "-" + levelIndex]:null;
            let resolution = args.resolution;
            if (varMetadata) {
                let banda = varMetadata.banda;
                let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                let retData = await gdal.getRegularMatrix(b.lng0, b.lat0, b.lng1, b.lat1, path, banda, resolution, config.publishPath);
                let info = await gdal.info(path, true, banda);
                let mdBanda = info.bands[banda - 1];
                let atributos = {};
                atributos["Nivel"] = mdBanda.description;
                atributos["Ejecución Modelo"] = varMetadata.modelo;
                atributos.Tiempo = time.valueOf();
                let md = mdBanda.metadata[""];
                if (md) {
                    atributos["Variable GFS"] = md.GRIB_COMMENT;
                    atributos["Disciplina GFS"] = md.GRIB_DISCIPLINE;
                    atributos["Unidad GFS"] = md.GRIB_UNIT;
                    atributos["Pronóstico"] = md.GRIB_FORECAST_SECONDS;
                }
                return {
                    metadata:varMetadata,
                    data:retData,
                    atributos:atributos
                }
            } else {
                return null;
            }
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaWindGLPNG(args) {
        try {
            let levelIndex = 0;
            if (args.levelIndex) levelIndex = args.levelIndex;
            let b = variables.normalizaBBox(args.lng0, args.lat0, args.lng1, args.lat1);
            let time = variables.normalizaTiempo(args.time);
            let metadata = await variables.getMetadata(time.valueOf());
            if (!metadata) throw "No hay Datos";
            let capa = this.getCapa(args.codigoVariable);
            if (!capa) throw "No se encontró la variable";
            let codigoVariableU = capa.opciones.magnitudCalculada.capaU;
            let codigoVariableV = capa.opciones.magnitudCalculada.capaV;
            let varMetadataU = metadata.variables[codigoVariableU + "-" + levelIndex];
            let varMetadataV = metadata.variables[codigoVariableV + "-" + levelIndex];
            if (!varMetadataU || !varMetadataV) throw "No hay Datos";            
            let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
            let bandaU = varMetadataU.banda;
            let bandaV = varMetadataV.banda;
            let dLng = args.lng1 - args.lng0;
            let dLat = args.lat1 - args.lat0;
            let width, height;
            const resolution = 200;
            let ret = {
                lat0:b.lat0, lat1:b.lat1, lng0:b.lng0, lng1:b.lng1, unit:varMetadataU.unit,
                time:time.valueOf(),
                levelIndex:levelIndex,
                mensajes:[], advertencias:[], errores:[],
                atributos:{}
            }
            if (dLng > dLat) {
                width = resolution;
                height = resolution * dLat / dLng;
            } else {
                height = resolution;
                width = resolution * dLng / dLat;
            }
            if (width != parseInt(width)) width = parseInt(width) + 1;
            if (height != parseInt(height)) height = parseInt(height) + 1;
            ret.mensajes.push("Usando resolución " + width + "[lng] x " + height + "[lat]");
            let [dataU, dataV] = await(
                Promise.all([
                    gdal.getRectangularMatrix(b.lng0, b.lat0, b.lng1, b.lat1, path, bandaU, width, height, config.publishPath),
                    gdal.getRectangularMatrix(b.lng0, b.lat0, b.lng1, b.lat1, path, bandaV, width, height, config.publishPath)
                ])
            );

            let info = await gdal.info(path, true);
            let mBandaU = info.bands[bandaU - 1];
            let mBandaV = info.bands[bandaV - 1];
            ret.atributos["Nivel"] = "U: " + mBandaU.description + ", V: " + mBandaV.description;
            ret.atributos.Tiempo = metadata.tiempo;
            let mdU = mBandaU.metadata[""];
            let mdV = mBandaV.metadata[""];
            if (mdU && mdV) {
                ret.atributos["Variable GFS"] = "U: " + mdU.GRIB_COMMENT + ", V: " + mdV.GRIB_COMMENT;
                ret.atributos["Disciplina GFS"] = "U: " + mdU.GRIB_DISCIPLINE + ", V: " + mdV.GRIB_DISCIPLINE;
                ret.atributos["Unidad GFS"] = "U: " + mdU.GRIB_UNIT + ", V: " + mdV.GRIB_UNIT;
                ret.atributos["Pronóstico"] = "U: " + mdU.GRIB_FORECAST_SECONDS + ", V: " + mdV.GRIB_FORECAST_SECONDS;
            }

            let u = []; 
            dataU.rows.forEach(row => row.forEach(value => u.push(value)));
            let v = []; 
            dataV.rows.forEach(row => row.forEach(value => v.push(value)));

            let minU, maxU, minV, maxV, min, max;
            if (u.length != v.length) throw "Datos inconsistentes (dimensiones u,v)";
            u.forEach((eU, i) => {
                let eV = v[i];
                if (minU === undefined || eU < minU) minU = eU;
                if (maxU === undefined || eU > maxU) maxU = eU;
                if (minV === undefined || eV < minV) minV = eV;
                if (maxV === undefined || eV > maxV) maxV = eV;
                let modulo = Math.sqrt(eU*eU + eV*eV);
                if (min === undefined || modulo < min) min = modulo;
                if (max === undefined || modulo > max) max = modulo;
            });
            v.forEach(v => {
                if (minV === undefined || v < minV) minV = v;
                if (maxV === undefined || v > maxV) maxV = v;
            });
            const png = new PNG({
                colorType: 2,
                filterType: 4,
                width: width,
                height: height
            });
            const deltaU = maxU - minU, deltaV = maxV - minV;            
            for (let y=0; y<height; y++) {
                for (let x=0; x<width; x++) {
                    const i = ((height - y - 1) * width + x) * 4;
                    const k = y * width + x;
                    png.data[i + 0] = Math.floor(255 * (u[k] - minU) / deltaU);
                    png.data[i + 1] = Math.floor(255 * (v[k] - minV) / deltaV);
                    png.data[i + 2] = 0;
                    png.data[i + 3] = 255;
                }
            }
            ret.width = width;
            ret.height = height;
            ret.uMin = minU;
            ret.uMax = maxU;
            ret.vMin = minV;
            ret.vMax = maxV;
            ret.min = min;
            ret.max = max;
            const fileName = "windgl-" + parseInt(10000*Math.random()) + ".png";
            let filePath = config.publishPath + "/" + fileName;
            ret.textureFile = fileName;
            
            await (new Promise(resolve => {
                let writeStream = fs.createWriteStream(filePath);
                writeStream.on("close", _ => resolve());
                png.pack().pipe(writeStream);
            }));

            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }

    async generaMatrizRectangular(args) {
        try { 
            let capa = this.getCapa(args.codigoVariable);
            if (!capa) throw "No se encontró la variable '" + args.codigoVariable + "'";
            if (capa.opciones.magnitudCalculada) {
                return await this.generaMatrizRectangularMagnitudCalculada(args);
            }
            let levelIndex = 0;
            if (args.levelIndex) levelIndex = args.levelIndex;
            let b = variables.normalizaBBox(args.lng0, args.lat0, args.lng1, args.lat1);
            let time = variables.normalizaTiempo(args.time);
            let metadata = await variables.getMetadata(time.valueOf());
            let varMetadata = metadata?metadata.variables[args.codigoVariable + "-" + levelIndex]:null;
            if (!varMetadata) throw "No hay Datos";
            let width = null, height = null;
            let maxWidth = args.maxWidth || 150;
            let maxHeight = args.maxHeight || 150;
            let dx = 0.25, dy = 0.25;
            if ((b.lng1 - b.lng0) / dx > maxWidth) {
                width = maxWidth; height = maxHeight;
            } 
            if ((b.lat1 - b.lat0) / dy > 150) {
                height = maxHeight; width = width || maxWidth;
            }
            let banda = varMetadata.banda;
            let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
            let data = await gdal.getRectangularMatrix(b.lng0, b.lat0, b.lng1, b.lat1, path, banda, width, height, config.publishPath);            
            if (!data.dx && data.cellsize) data.dx = data.cellsize;
            if (!data.dy && data.cellsize) data.dy = data.cellsize;
            data.lng0 = data.xllcorner; data.lng1 = data.lng0 + data.dx * data.ncols;
            data.lat0 = data.yllcorner; data.lat1 = data.lat0 + data.dy * data.nrows;
            data.unit = variables.units[args.codigoVariable];
            if (width && height) data.advertencias = ["Se han interpolado los resultados para ajustarse a una resolución de " + width + "[lng] x " + height + "[lat]. Para obtener los datos originales, consulte por un área más pequeña."];
            return data;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }
    async generaMatrizRectangularMagnitudCalculada(args) {
        try {
            let capa = this.getCapa(args.codigoVariable);
            let argsU = JSON.parse(JSON.stringify(args)); argsU.codigoVariable = capa.opciones.magnitudCalculada.capaU;
            let argsV = JSON.parse(JSON.stringify(args)); argsV.codigoVariable = capa.opciones.magnitudCalculada.capaV;
            let [dataU, dataV] = await Promise.all([
                this.generaMatrizRectangular(argsU),
                this.generaMatrizRectangular(argsV)
            ]);
            
            if (dataU !== undefined && dataV !== undefined) {
                let min = undefined, max = undefined;
                let data = dataU;
                for (let i=0; i<data.rows.length; i++) {
                    let row = data.rows[i];
                    for (let j=0; j<row.length; j++) {
                        let u = row[j], v = dataV.rows[i][j];
                        let value = Math.sqrt(u * u + v * v)
                        row[j] = value;
                        if (min === undefined || value < min) min = value;
                        if (max === undefined || value > max) max = value;
                    }
                }
                data.min = min;
                data.max = max;
                data.unit = "m/s";
                return data;
            } else {
                throw "Componente U y V no encontrados";
            }
        } catch(error) {
            console.error(error);
            throw error;
        }
    }
}

module.exports = ProveedorCapasGFS4;