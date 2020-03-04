const config = require("./Config").getConfig();
const moment = require("moment-timezone");
const fs = require("fs");
const gdal = require("./GDAL");
const PNG = require("pngjs").PNG;

class Variables {
    static get instance() {
        if (Variables.singleton) return Variables.singleton;
        Variables.singleton = new Variables();
        return Variables.singleton;
    }
    constructor() {
        this.units = Object.keys(config.variablesPorBanda).reduce((map, gribElementCode) => {
            let vars = config.variablesPorBanda[gribElementCode];
            vars.forEach(v => map[v.code] = v.unit);
            return map;
        }, {});
        fs.mkdir(config.dataPath + "/tmp", err => {
        });
        fs.mkdir(config.dataPath + "/tmp/windgl-files", err => {
        });
    }

    normalizaTiempo(timestamp) {
        let dt = moment.tz(timestamp, "UTC");
        dt.minutes(0); dt.seconds(0); dt.milliseconds(0);
        let hh = dt.hours();
        if (hh % 3) {
            if (hh % 3 == 1) dt.subtract(1, "hours");
            else dt.add(1, "hours");
        }
        return dt;
    }
    getPath(tiempo) {
        return config.dataPath + "/" + tiempo.format("YYYY") + "/" + tiempo.format("MM");
    }
    getMetadata(timestamp) {
        return new Promise((resolve, reject) => {
            let dt = this.normalizaTiempo(timestamp);
            let path = this.getPath(dt) + "/" + dt.format("DD_HH00") + ".metadata";  
            fs.readFile(path, (err, data) => {
                let metadata = null;
                if (!err) {
                    metadata = JSON.parse(data);
                }
                resolve(metadata);
            });
        });
    }
    setMetadata(timestamp, metadata) {
        return new Promise((resolve, reject) => {
            let dt = this.normalizaTiempo(timestamp);
            let path = this.getPath(dt) + "/" + dt.format("DD_HH00") + ".metadata";
            fs.writeFile(path, JSON.stringify(metadata), err => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve();
            })
        });
    }
    async findMetadata(timestamp, dsCode, levelIndex) {
        let varCode = dsCode + "-" + levelIndex;         
        let t0 = this.normalizaTiempo(timestamp).valueOf();
        let intentos = 0;
        while (intentos < 50) {
            let t = t0 - 3*intentos * 60 * 60 * 1000;
            let m = await this.getMetadata(t);
            if (m && m.variables[varCode]) {
                m.tiempo = t;
                return m;
            }
            if (intentos > 0) {
                t = t0 + 3 * 60 * 60 * 1000;
                m = await this.getMetadata(t);
                if (m && m.variables[varCode]) {
                    m.tiempo = t;
                    return m;
                }
            }
            intentos++;
        }
        return null;
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

    exportaTIFF(band, srcPath, outPath, lng0, lat0, lng1, lat1) {
        return new Promise((resolve, reject) => {
            let bbox = this.normalizaBBox(lng0, lat0, lng1, lat1);
            if (bbox.lng0 == bbox.lng1 || bbox.lat0 == bbox.lat1) reject("Área sin Datos");
            gdal.translateWindow(bbox.lng0, bbox.lat0, bbox.lng1, bbox.lat1, srcPath, outPath, [band])
                .then(_ => resolve(bbox))
                .catch(err => reject(err));
        });
    }

    calculaMagnitud(inputFileU, inputFileV, outputPath) {
        return new Promise((resolve, reject) => {
            gdal.calc([{
                codigo:"U", path:inputFileU
            }, {
                codigo:"V", path:inputFileV
            }], outputPath, "numpy.sqrt(U*U + V*V)")
            .then(_ => resolve())
            .catch(err => reject(err));
        });
    }


    // POMeO RemotePlugin API
    getDataSources(req, res) {
        let ds = [];
        Object.keys(config.variablesPorBanda).forEach(gribElement => {
            let variables = config.variablesPorBanda[gribElement];
            variables.forEach(v => {
                let options = {}
                if (v.levels.length > 1) {
                    options.niveles = v.niveles.reduce((list, l) => {
                        list.push(l.descripcion);
                        return list;
                    }, []);
                    options.nivelDefault = v.nivelInicial;
                }
                options.unidad = v.unit;
                options.decimales = v.decimales !== undefined?v.decimales:2;
                options.temporal = true;
                if (v.defaults) {
                    options.defaults = v.defaults;
                } else {
                    options.defaults = {
                        CapaVisualizadoresMapa:{
                            config:{
                                opacidad:80
                            },
                            visualizadores:{
                                isocurvas:{
                                    inicial:true,
                                    lineColor:"rgb(50,50,50)",
                                    lineWidth:0.75
                                }
                            }
                        }
                    }
                }
                ds.push({
                    codigo:v.code, 
                    nombre:v.name, 
                    grupos:v.grupos, 
                    origen:"gfs", 
                    formatos:["REGULAR_MATRIX", "POINT_TIME_SERIE", "POINT_TIME_VALUE"],
                    opciones:options,
                    icono:v.icono
                });
            });
        });
        ds.push({
            codigo:"VIENTO_10m",
            nombre:"Viento a 10 m",
            grupos:["meteorologia"],
            icono:"img/variables/velocidad-viento.svg",
            origen:"gfs", 
            formatos:["WIND_GL", "VECTOR_REGULAR_MATRIX", "REGULAR_MATRIX", "POINT_TIME_SERIE", "POINT_TIME_VALUE"],
            opciones:{
                unidad:"m/s",
                decimales:2,
                temporal:true,
                defaults:{CapaVisualizadoresMapa:{config:{opacidad:80},visualizadores:{particulas:{inicial:true}}}}
            }
        });
        ds.push({
            codigo:"VIENTO",
            nombre:"Viento",
            grupos:["meteorologia"],
            icono:"img/variables/velocidad-viento.svg",
            origen:"gfs", 
            formatos:["WIND_GL", "VECTOR_REGULAR_MATRIX", "REGULAR_MATRIX", "POINT_TIME_SERIE", "POINT_TIME_VALUE"],
            opciones:{
                unidad:"m/s",
                decimales:2,
                temporal:true,
                defaults:{CapaVisualizadoresMapa:{config:{opacidad:80},visualizadores:{particulas:{inicial:true}, isocurvas:{lineColor:"rgb(50,50,50)",lineWidth:0.75}}}},
                niveles:["300 hPa", "500 hPa", "700 hPa", "850 hPa", "1000 hPa"],
                nivelDefault:3
            }
        })
        ds.sort((ds1, ds2) => (ds1.nombre>ds2.nombre?1:-1));
        res.setHeader('Content-Type', 'application/json');
        res.status(200);
        res.send(ds); 
    }

    returnError(res, error) {
        if (typeof error == "string") {
            res.statusMessage = error;
            res.status(400).end();
        } else { 
            //console.trace(error);
            res.status(500).send(error.toString());
        }
    }
    async queryDataSource(req, res) {
        try {
            let format = req.body.format;
            let ret;
            switch(format) {
                case "REGULAR_MATRIX":
                    ret = await this.getRegularMatrix(req);
                    break;
                case "VECTOR_REGULAR_MATRIX":
                    ret = await this.getVectorRegularMatrix(req);
                    break;
                case "WIND_GL":
                    ret = await this.getWindGL(req);
                    break;
                case "POINT_TIME_SERIE":
                    ret = await this.getPointTimeSerie(req);
                    break;
                case "POINT_TIME_VALUE":
                    ret = await this.getPointTimeValue(req);
                    break;
                default:
                    throw "Formato '" + format + "' no soportado";
            }
            res.setHeader('Content-Type', 'application/json');
            res.status(200);
            res.send(JSON.stringify(ret)); 
        } catch(error) {
            console.error(error);
            this.returnError(res, error);
        }
    }

    async getRegularMatrix(req) {
        try {
            let especiales = ["VIENTO_10m", "VIENTO"];
            let dsCode = req.body.dsCode;
            let casoEspecial = especiales.includes(dsCode);
            let query = req.body.query;
            let levelIndex = 0;
            if (query.levelIndex) levelIndex = query.levelIndex;
            let metadata = await this.findMetadata(query.time, dsCode, levelIndex);
            if (!metadata) {
                throw "No hay datos GFS importados para el día";
            }
            let varMetadata = metadata.variables[dsCode + "-" + levelIndex];
            if (!varMetadata && !casoEspecial) throw "No hay datos para la variable '" + dsCode + "' (nivel " + levelIndex + ")";
            let banda = varMetadata?varMetadata.banda:"especial";
    
            let dt = this.normalizaTiempo(query.time);
            let path = this.getPath(dt) + "/" + dt.format("DD_HH00") + ".grb2";
            let lat0 = query.lat0, lat1 = query.lat1, lng0 = query.lng0, lng1 = query.lng1;
            if (lat0 < config.limites.s) lat0 = config.limites.s;
            if (lat1 > config.limites.n) lat1 = config.limites.n;
            if (lng0 < config.limites.w) lng0 = config.limites.w;
            if (lng1 > config.limites.e) lng1 = config.limites.e;
            let ret = {
                lat0:lat0, lat1:lat1, lng0:lng0, lng1:lng1, unit:this.units[dsCode],
                resolution:query.resolution, time:dt.valueOf(),
                deltaLat:(lat1 - lat0) / query.resolution,
                deltaLng:(lng1 - lng0) / query.resolution,
                levelIndex:levelIndex,
                metadata:varMetadata
            }
    
            //ret.data = await gdal.getRegularMatrix(lng0+180, lat1, lng1+180, lat0, path, banda, query.resolution, config.dataPath + "/tmp");
            let west = lng0;
            if (west < 0) west += 360;
            let east = lng1;
            if (east < 0) east += 360;
            // Casos especiales (vectores)
            if (dsCode == "VIENTO_10m" || dsCode == "VIENTO") {
                if (dsCode == "VIENTO_10m") varMetadata = metadata.variables["UGRD_10M-0"];
                else if (dsCode == "VIENTO") varMetadata = metadata.variables["UGRD_HP-" + levelIndex];                
                if (!varMetadata) throw "No hay datos del componente u del viento para el día";
                ret.metadata = varMetadata;
                let u = await gdal.getRegularMatrix(west, lat1, east, lat0, path, varMetadata.banda, query.resolution, config.dataPath + "/tmp");
                if (dsCode == "VIENTO_10m") varMetadata = metadata.variables["VGRD_10M-0"];
                else if (dsCode == "VIENTO") varMetadata = metadata.variables["VGRD_HP-" + levelIndex];                
                if (!varMetadata) throw "No hay datos del componente v del viento para el día";
                let v = await gdal.getRegularMatrix(west, lat1, east, lat0, path, varMetadata.banda, query.resolution, config.dataPath + "/tmp");
                let data = [];
                for (let i=0; i<u.length; i++) {
                    data.push(Math.sqrt(Math.pow(u[i],2) + Math.pow(v[i],2)));
                }
                ret.data = data;
            } else {
                ret.data = await gdal.getRegularMatrix(west, lat1, east, lat0, path, banda, query.resolution, config.dataPath + "/tmp");
            }
            return ret;
        } catch(error) {
            throw error;
        }
    }

    async getWindGL(req) {
        try {
            let dsCode = req.body.dsCode;
            let query = req.body.query;
            let levelIndex = 0;
            if (query.levelIndex) levelIndex = query.levelIndex;
            let metadata = await this.findMetadata(query.time, dsCode, levelIndex);
            if (!metadata) {
                throw "No hay datos GFS importados para el día";
            }
    
            let dt = this.normalizaTiempo(query.time);
            let path = this.getPath(dt) + "/" + dt.format("DD_HH00") + ".grb2";
            let lat0 = query.lat0, lat1 = query.lat1, lng0 = query.lng0, lng1 = query.lng1;
            if (lat0 < config.limites.s) lat0 = config.limites.s;
            if (lat1 > config.limites.n) lat1 = config.limites.n;
            if (lng0 < config.limites.w) lng0 = config.limites.w;
            if (lng1 > config.limites.e) lng1 = config.limites.e;
            let ret = {
                lat0:lat0, lat1:lat1, lng0:lng0, lng1:lng1, unit:this.units[dsCode],
                time:dt.valueOf(),
                levelIndex:levelIndex
            }
    
            let west = lng0;
            if (west < 0) west += 360;
            let east = lng1;
            if (east < 0) east += 360;
            let dsCode1, dsCode2, varMetadata1, varMetadata2;
            if (dsCode == "VIENTO_10m") {
                dsCode1 = "UGRD_10M-0";
                dsCode2 = "VGRD_10M-0";
            } else {
                dsCode1 = "UGRD_HP-" + levelIndex;
                dsCode2 = "VGRD_HP-" + levelIndex;
            }
            varMetadata1 = metadata.variables[dsCode1];
            varMetadata2 = metadata.variables[dsCode2];
            if (!varMetadata1 || !varMetadata2) throw "No hay datos de viento para el día indicado";
            ret.metadata = varMetadata1;
            let dLng = lng1 - lng0;
            let dLat = lat1 - lat0;
            let width, height;
            const resolution = 200;
            if (dLng > dLat) {
                width = resolution;
                height = resolution * dLat / dLng;
            } else {
                height = resolution;
                width = resolution * dLng / dLat;
            }
            if (width != parseInt(width)) width = parseInt(width) + 1;
            if (height != parseInt(height)) height = parseInt(height) + 1;
            let u = await gdal.getRectangularMatrix(west, lat1, east, lat0, path, varMetadata1.banda, width, height, config.dataPath + "/tmp");
            let v = await gdal.getRectangularMatrix(west, lat1, east, lat0, path, varMetadata2.banda, width, height, config.dataPath + "/tmp");
            let minU, maxU, minV, maxV;
            u.forEach(u => {
                if (minU === undefined || u < minU) minU = u;
                if (maxU === undefined || u > maxU) maxU = u;
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
                    //const k = y * width + (x + width / 2) % width;
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
            const fileName = "windgl-" + parseInt(10000*Math.random()) + ".png";
            let filePath = config.dataPath + "/tmp/windgl-files/" + fileName;
            if (config.customWindGLConf) {
                ret.textureURL = config.customWindGLConf.publishURL + "/" + fileName;
                filePath = config.customWindGLConf.publishPath + "/" + fileName;
            } else {
                ret.textureFile = fileName;
            }
            
            await (new Promise(resolve => {
                let writeStream = fs.createWriteStream(filePath);
                writeStream.on("close", _ => resolve());
                png.pack().pipe(writeStream);
            }));
            // 10 segundos para descargar la imagen antes de borrarla
            setTimeout(_ => {
                fs.unlink(filePath, _ => {});
            }, 10000);
            return ret;
        } catch(error) {
            throw error;
        }
    }

    async getVectorRegularMatrix(req) {
        try {
            let dsCode = req.body.dsCode;
            let query = req.body.query;
            let levelIndex = 0;
            if (query.levelIndex) levelIndex = query.levelIndex;
            let metadata = await this.findMetadata(query.time, dsCode, levelIndex);
            if (!metadata) {
                throw "No hay datos GFS importados para el día";
            }
            let dsCode1, dsCode2;
            if (dsCode == "VIENTO_10m") {                            
                dsCode1 = "UGRD_10M-0";
                dsCode2 = "VGRD_10M-0";
            } else {
                dsCode1 = "UGRD_HP-" + levelIndex;
                dsCode2 = "VGRD_HP-" + levelIndex;
            }
            let varMetadata1 = metadata.variables[dsCode1];
            let varMetadata2 = metadata.variables[dsCode2];
            if (!varMetadata1 || !varMetadata2) throw "No hay datos para el día";
    
            let dt = this.normalizaTiempo(query.time);
            let path = this.getPath(dt) + "/" + dt.format("DD_HH00") + ".grb2";
            let lat0 = query.lat0, lat1 = query.lat1, lng0 = query.lng0, lng1 = query.lng1;
            if (lat0 < config.limites.s) lat0 = config.limites.s;
            if (lat1 > config.limites.n) lat1 = config.limites.n;
            if (lng0 < config.limites.w) lng0 = config.limites.w;
            if (lng1 > config.limites.e) lng1 = config.limites.e;
            let ret = {
                lat0:lat0, lat1:lat1, lng0:lng0, lng1:lng1, unit:"m/s",
                resolution:query.resolution, time:dt.valueOf(),
                deltaLat:(lat1 - lat0) / query.resolution,
                deltaLng:(lng1 - lng0) / query.resolution,
                levelIndex:levelIndex,
                metadata:varMetadata1
            }
            let west = lng0;
            if (west < 0) west += 360;
            let east = lng1;
            if (east < 0) east += 360;
            let u = await gdal.getRegularMatrix(west, lat1, east, lat0, path, varMetadata1.banda, query.resolution, config.dataPath + "/tmp");
            let v = await gdal.getRegularMatrix(west, lat1, east, lat0, path, varMetadata2.banda, query.resolution, config.dataPath + "/tmp");
            ret.data = [];
            for (let i=0; i<u.length; i++) ret.data.push([u[i], v[i]]);
            return ret;
        } catch(error) {
            throw error;
        }
    }

    async getPointTimeSerie(req) {
        try {
            let dsCode = req.body.dsCode;
            let query = req.body.query;
            let levelIndex = 0;
            if (query.levelIndex) levelIndex = query.levelIndex;
            let lat = query.lat;
            let lng = query.lng;
            let time0 = this.normalizaTiempo(query.time0);
            let time1 = this.normalizaTiempo(query.time1);

            let puntosPendientes = [], puntosPendientes2 = [];
            let time = time0.clone();
            while (!time.isAfter(time1)) {
                let metadata = await this.getMetadata(time);
                if (metadata) {
                    if (dsCode == "VIENTO_10m" || dsCode == "VIENTO") {
                        let dsCode1, dsCode2;
                        if (dsCode == "VIENTO_10m") {                            
                            dsCode1 = "UGRD_10M-0";
                            dsCode2 = "VGRD_10M-0";
                        } else {
                            dsCode1 = "UGRD_HP-" + levelIndex;
                            dsCode2 = "VGRD_HP-" + levelIndex;
                        }
                        let varMetadata1 = metadata.variables[dsCode1];
                        let varMetadata2 = metadata.variables[dsCode2];
                        if (varMetadata1 && varMetadata2) {
                            let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                            if (lng < 0) lng += 360;
                            puntosPendientes.push({time:time.valueOf(), lng:lng, lat:lat, path:path, banda:varMetadata1.banda, tmpPath:config.dataPath + "/tmp", metadata:varMetadata1})
                            puntosPendientes2.push({time:time.valueOf(), lng:lng, lat:lat, path:path, banda:varMetadata2.banda, tmpPath:config.dataPath + "/tmp", metadata:varMetadata2})
                        }
                    } else {
                        let varMetadata = metadata.variables[dsCode + "-" + levelIndex];
                        if (varMetadata) {
                            let banda = varMetadata.banda;
                            let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                            if (lng < 0) lng += 360;
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
                ret.unit = this.units[dsCode];
                return ret;
            }  
            if (dsCode == "VIENTO_10m" || dsCode == "VIENTO") {
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
                ret.unit = this.units[dsCode];
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

    async getPointTimeValue(req) {
        try {
            let dsCode = req.body.dsCode;
            let query = req.body.query;
            let levelIndex = 0;
            if (query.levelIndex) levelIndex = query.levelIndex;
            let lat = query.lat;
            let lng = query.lng;
            let time = this.normalizaTiempo(query.time);
            let ret = {
                lat:lat, lng:lng,
                time:time.valueOf(), levelIndex:levelIndex
            }    

            if (dsCode == "VIENTO_10m" || dsCode == "VIENTO") {
                let metadata;
                ret.unit = "m/s";
                let dsCode1, dsCode2;
                if (dsCode == "VIENTO_10m") {
                    dsCode1 = "UGRD_10M-0";
                    dsCode2 = "VGRD_10M-0";
                    metadata = await this.findMetadata(query.time, "UGRD_10M", 0);
                } else {
                    dsCode1 = "UGRD_HP-" + levelIndex;
                    dsCode2 = "VGRD_HP-" + levelIndex;
                    metadata = await this.findMetadata(query.time, "UGRD_HP", 0);
                }
                if (metadata) {
                    let varMetadata1 = metadata.variables[dsCode1];
                    let varMetadata2 = metadata.variables[dsCode2];
                    if (!varMetadata1 || !varMetadata2) throw "No hay datos para el día";
                    let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                    if (lng < 0) lng += 360;
                    ret.metadata = varMetadata1;
                    let u = await gdal.getPointValue(lng, lat, path, varMetadata1.banda, config.dataPath + "/tmp");
                    let v = await gdal.getPointValue(lng, lat, path, varMetadata2.banda, config.dataPath + "/tmp");
                    ret.data = Math.sqrt(Math.pow(u, 2) + Math.pow(v,2));
                }
            } else {
                let metadata = await this.findMetadata(query.time, dsCode, levelIndex);
                if (metadata) {
                    ret.unit = this.units[dsCode];
                    let varMetadata = metadata.variables[dsCode + "-" + levelIndex];
                    if (!varMetadata) throw "No hay datos para el día";
                    let banda = varMetadata.banda;
                    let path = this.getPath(time) + "/" + time.format("DD_HH00") + ".grb2";
                    if (lng < 0) lng += 360;
                    ret.metadata = varMetadata;
                    ret.data = await gdal.getPointValue(lng, lat, path, banda, config.dataPath + "/tmp");
                }
            }
            return ret;
        } catch(error) {
            console.error(error);
            throw error;
        }
    }
}

module.exports = Variables.instance;