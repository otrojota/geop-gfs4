const https = require('https');
const fs = require('fs');
const config = require("./Config").getConfig();
const gdal = require("./GDAL");
const variables = require("./Variables");
const concat = require("concat-files");
const moment = require("moment-timezone");

class DescargaPronostico {
    constructor(ejecucion, horaPronostico) {
        this.ejecucion = ejecucion;
        this.horaPronostico = horaPronostico;
        this.hhh = "" + horaPronostico;
        if (this.hhh.length < 3) this.hhh = "0" + this.hhh;
        if (this.hhh.length < 3) this.hhh = "0" + this.hhh;
        this.nReintentos = 0;        
    }

    muestraLogTiempo(t0, mensaje) {
        let t1 = new Date().getTime();
        let dt = parseInt((t1 - t0) / 1000);
        console.log(mensaje + " en " + dt + "[seg]");
    }
    descarga() {
        return new Promise((resolve, reject) => {
            let dstFile = config.dataPath + "/downloads/gfs4_" + this.hhh + ".grb2";
            let url = this.ejecucion.getNOAAUrl(this.horaPronostico);
            console.log("descargando:" + url + " => " + dstFile);
            let t0 = new Date().getTime();
            let file = fs.createWriteStream(dstFile);
            https.get(url, response => {
                response.pipe(file);
                file.on('finish', _ => {
                    file.close(_ => {
                        this.muestraLogTiempo(t0, "gfs4_" + this.hhh + ".grb2 descargado");
                        this.importa(dstFile)
                            .then(_ => resolve())
                            .catch(err => reject(err))
                    });
                });
                file.on('error', err => {
                    try {
                        fs.unlink(dstFile);
                    } catch(err) {}
                    reject(err);
                });
            })
        });
    }

    creaDirectorio(path) {
        return new Promise((resolve, reject) => {
            fs.mkdir(path, err => {
                if (err && err.code != "EEXIST") {
                    reject(err);
                } else {
                    resolve();
                }
            }); 
        })
    }
    appendToFile(appendTo, appendFrom) {
        return new Promise((resolve, reject) => {
            let newFile = appendTo + ".tmp";
            concat([appendTo, appendFrom], newFile, err => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.unlink(appendTo, err => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    fs.rename(newFile, appendTo, err => {
                        if (err) {
                            reject(err);
                            return;
                        }
                        resolve();
                    })
                });
            })
        });
    }
    deleteFile(path) {
        return new Promise((resolve, reject) => {
            fs.unlink(path, err => {
                if (err) reject(err);
                resolve();
            })
        });
    }
    renameFile(path, toPath) {
        return new Promise((resolve, reject) => {
            fs.rename(path, toPath, err => {
                if (err) reject(err);
                resolve();
            })
        });
    }    
    existsFile(path) {
        return new Promise(resolve => {
            fs.access(path, fs.F_OK, (err) => {
                if (err) resolve(false)
                else resolve(true);
              })
        });
    }


    getVariablePorMetadataGRIB(gribBandMetadata) {
        let variables = config.variablesPorBanda[gribBandMetadata.GRIB_ELEMENT];
        if (!variables) return {variable:null, nivel:-1};;
        let shortName = gribBandMetadata.GRIB_SHORT_NAME;
        let foundVar = null, foundLevelIndex = -1;
        variables.some(variable => {
            let idx = variable.niveles.findIndex(n => n.gribShortName == shortName);
            if (idx >= 0) {
                foundVar = variable;
                foundLevelIndex = idx;
                return true;
            }
        });
        return {variable:foundVar, nivel:foundLevelIndex};
    }
    async reindexa(path) {
        try {
            let varMetadatas = {variables:{}}
            let info = await gdal.info(path, true);
            for (let i=0; i<info.bands.length; i++) {
                let metadata = info.bands[i].metadata[""];
                let {variable, nivel} = this.getVariablePorMetadataGRIB(metadata);
                if (variable) {
                    let varMetadata = {
                        banda:info.bands[i].band,
                        min:info.bands[i].computedMin,
                        max:info.bands[i].computedMax,
                        lat0:info.cornerCoordinates.lowerLeft[1],
                        lat1:info.cornerCoordinates.upperLeft[1],
                        lng0:info.cornerCoordinates.lowerLeft[0],
                        lng1:info.cornerCoordinates.lowerRight[0],
                        width:info.size[0],
                        height:info.size[1]
                    };
                    if (info.bands[i].noDataValue !== undefined) varMetadata.noDataValue = info.bands[i].noDataValue;
                    let refTime = parseInt(metadata.GRIB_REF_TIME);
                    let forecastSeconds = parseInt(metadata.GRIB_FORECAST_SECONDS);
                    if (isNaN(refTime) || isNaN(forecastSeconds)) {
                        console.warn(`Reindexando '${path}': No se puede rescatar tiempo del modelo para GRIB_ELEMENT='${metadata.GRIB_ELEMENT}'`);
                    } else {
                        let tiempoModelo = moment.tz(refTime * 1000, "UTC");
                        //tiempoModelo.add(forecastSeconds, "seconds");
                        varMetadata.modelo = tiempoModelo.format("YYYY-MM-DD HH:mm") + " (UTC)";
                    }
                    Object.keys(metadata).forEach(k => varMetadata[k] = metadata[k]);
                    varMetadatas.variables[variable.codigo + "-" + nivel] = varMetadata;
                } else {
                    console.warn(`Reindexando '${path}': No se encuentra definición de variable para GRIB_ELEMENT='${metadata.GRIB_ELEMENT}'`);
                }
            }
            let p = path.lastIndexOf(".");
            let mdPath = path.substr(0,p) + ".metadata";
            await new Promise((resolve, reject) => {
                fs.writeFile(mdPath, JSON.stringify(varMetadatas), err => {
                    if (err) reject(err);
                    else resolve();
                })
            })
        } catch(error) {
            console.error(error);
            throw error;
        }
    }
    async importa(fileName) {        
        try {
            // Obtener metadata del archivo que se importa
            let info = await gdal.info(fileName);
            // Recorrer cada banda para identificar las que deben ser importadas (encuentra variable)
            let srcBands = [];
            let mapaImportadas = {}; //codigoVariable-nivel:true
            for (let i=0; i<info.bands.length; i++) {
                let metadata = info.bands[i].metadata[""];
                let {variable, nivel} = this.getVariablePorMetadataGRIB(metadata);
                if (variable) {
                    srcBands.push(info.bands[i].band);
                    mapaImportadas[variable.codigo + "-" + nivel] = true;
                }
            }
            let tiempoPronostico = this.ejecucion.tiempo.clone();
            tiempoPronostico.add(this.horaPronostico, "hours");
            let outPath = config.dataPath + "/" + tiempoPronostico.format("YYYY");
            await this.creaDirectorio(outPath);
            outPath += "/" + tiempoPronostico.format("MM");
            await this.creaDirectorio(outPath);
            let outFileName = tiempoPronostico.format("DD_HH00") + ".grb2";
            let c = gdal.coordenadasProjection(config.limites.w, config.limites.s, config.limites.e, config.limites.n);
            await gdal.translateWindow(c.w, c.s, c.e, c.n, fileName, outPath + "/tmp_" + outFileName, srcBands);

            // Buscar si en algún pronóstico anterior para el mismo día hay otras variables no incluidas en
            // la ejecución actual del modelo.
            let existeAnterior = await this.existsFile(outPath + "/" + outFileName);
            if (existeAnterior) {
                let infoAnterior = await gdal.info(outPath + "/" + outFileName);
                let bandasARescatar = [];
                for (let i=0; i<infoAnterior.bands.length; i++) {
                    let metadata = infoAnterior.bands[i].metadata[""];
                    let {variable, nivel} = this.getVariablePorMetadataGRIB(metadata);
                    if (variable) {
                        if (!mapaImportadas[variable.codigo + "-" + nivel]) {
                            bandasARescatar.push(infoAnterior.bands[i].band);
                        }
                    }
                }
                if (bandasARescatar.length) {
                    await gdal.translate(outPath + "/" + outFileName, outPath + "/" + outFileName + ".xtr.grib2", bandasARescatar);
                    await this.appendToFile(outPath + "/tmp_" + outFileName, outPath + "/" + outFileName + ".xtr.grib2");
                    await this.deleteFile(outPath + "/" + outFileName + ".xtr.grib2");   
                }
                try {
                    await this.deleteFile(outPath + "/" + outFileName);
                } catch(error) {
                    console.error("No se puede eliminar archivo " + outPath + "/" + outFileName, error)
                    // Si el archivo está en uso, se falla para que se reintente
                    throw error;
                }
            }
            await this.renameFile(outPath + "/tmp_" + outFileName, outPath + "/" + outFileName);
            console.log("indexando " + outPath + "/" + outFileName);
            await this.reindexa(outPath + "/" + outFileName);
            //console.warn("No se borra el archivo origen ... modo prueba:" + fileName);
            await this.deleteFile(fileName);
        } catch(error) {            
            console.error("Error importando " + fileName, error);
            throw error;
        }
    }

    async fullReindexar() {
        try {
            let anos = fs.readdirSync(config.dataPath, {withFileTypes:true})
                .filter(dirent => dirent.isDirectory() && !isNaN(parseInt(dirent.name)) && dirent.name.length == 4);
            for (let i=0; i<anos.length; i++) {
                let pathAno = config.dataPath + "/" + anos[i].name;
                let meses = fs.readdirSync(pathAno, {withFileTypes:true})
                    .filter(dirent => dirent.isDirectory() && !isNaN(parseInt(dirent.name)) && dirent.name.length == 2);
                for (let j=0; j<meses.length; j++) {
                    let pathMes = pathAno + "/" + meses[j].name;
                    let files = fs.readdirSync(pathMes, {withFileTypes:true})
                        .filter(dirent => dirent.isFile() && dirent.name.endsWith(".grb2"));
                    for (let k=0; k<files.length; k++) {
                        let path = pathMes + "/" + files[k].name;
                        console.log("Reindexando " + path);
                        try {
                            await this.reindexa(path);                            
                        } catch(error) {                            
                        }
                    }
                }
            }
        } catch(error) {
            console.error(error);
        }
    }
}

module.exports = DescargaPronostico;