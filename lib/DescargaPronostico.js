const https = require('https');
const fs = require('fs');
const config = require("./Config").getConfig();
const gdal = require("./GDAL");
const variables = require("./Variables");
const concat = require("concat-files");

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
    async importa(fileName) {        
        try {
            let t00 = new Date().getTime();
            let t0 = new Date().getTime();
            console.log("Obteniendo metadata de " + fileName);
            let info = await gdal.info(fileName);
            this.muestraLogTiempo(t0, "Metadata de " + fileName + " obtenida");
            let srcBands = [];
            let tgtMetadata = {
                variables:{}    // codigo-idxBanda:{levels:{idxLevel:nroBanda}}
            }
            let metadataModelo = this.ejecucion.tiempo.format("YYYY-MM-DD HH:mm");
            // Recorrer cada banda para identificar las variables que deben ser importadas
            let variablesPorBanda = config.variablesPorBanda;
            for (let i=0; i<info.bands.length; i++) {
                let metadata = info.bands[i].metadata[""];
                let gribElement = metadata.GRIB_ELEMENT;
                let variables = variablesPorBanda[gribElement];
                if (!variables) continue;
                let shortName = metadata.GRIB_SHORT_NAME;
                let agrego = false;
                let j = 0;
                while(j <variables.length && !agrego) {
                    let variable = variables[j];
                    let idx = variable.niveles.findIndex(l => l.gribShortName == shortName);
                    if (idx >= 0) {
                        agrego = true;
                        srcBands.push(info.bands[i].band);
                        tgtMetadata.variables[variable.code + "-" + idx] = {
                            banda:Object.keys(tgtMetadata.variables).length + 1,
                            modelo:metadataModelo
                        }
                    } else {
                        j++;
                    }
                }
            }
            let tiempoPronostico = this.ejecucion.tiempo.clone();
            tiempoPronostico.add(this.horaPronostico, "hours");
            let outPath = config.dataPath + "/" + tiempoPronostico.format("YYYY");
            await this.creaDirectorio(outPath);
            outPath += "/" + tiempoPronostico.format("MM");
            await this.creaDirectorio(outPath);
            let outFileName = tiempoPronostico.format("DD_HH00") + ".grb2";
            console.log("Importando variables de " + outFileName + " en archivo temporal");            
            t0 = new Date().getTime();
            //await gdal.translateWindow(config.limites.w + 180, config.limites.n, config.limites.e + 180, config.limites.s, fileName, outPath + "/tmp_" + outFileName, srcBands);
            let west = config.limites.w;
            if (west < 0) west += 180;
            let east = config.limites.e;
            if (east < 0) east += 360;
            await gdal.translateWindow(west, config.limites.n, east, config.limites.s, fileName, outPath + "/tmp_" + outFileName, srcBands);
            this.muestraLogTiempo(t0, "archivo temporal para " + outFileName + " creado ");
            console.log("archivo " + outPath + "/tmp_" + outFileName + " creado");
            // Buscar si en algún pronóstico anterior para el mismo día hay otras variables no incluidas en
            // la ejecución actual del modelo.
            let oldMetadata = await variables.getMetadata(tiempoPronostico.valueOf());
            if (oldMetadata) {
                let bandsToCopy = [];
                Object.keys(oldMetadata.variables).forEach(key => {
                    if (!tgtMetadata.variables[key]) {
                        let oldVar = oldMetadata.variables[key];
                        bandsToCopy.push(oldVar.banda);
                        tgtMetadata.variables[key] = {
                            banda:Object.keys(tgtMetadata.variables).length + 1,
                            modelo:oldVar.modelo
                        }
                    }
                });
                if (bandsToCopy.length) {
                    console.log("copiando " + bandsToCopy.length + " variables desde el pronóstico del modelo anterior para el mismo día, no contenidas en la nueva ejecución")
                    let oldGribPath = outPath + "/" + outFileName;
                    await gdal.translate(oldGribPath, oldGribPath + ".xtr.grib2", bandsToCopy);
                    await this.appendToFile(outPath + "/tmp_" + outFileName, oldGribPath + ".xtr.grib2");
                    await this.deleteFile(oldGribPath + ".xtr.grib2");                    
                } else {
                    console.log("no hay variables que rescatar desde el pronóstico anterior para el mismo día")
                }
            }
            try {
                await this.deleteFile(outPath + "/" + outFileName);
            } catch(err) {
                console.log("Primer pronóstico para el día [" + outFileName + "]");
            }
            await this.renameFile(outPath + "/tmp_" + outFileName, outPath + "/" + outFileName);
            await variables.setMetadata(tiempoPronostico.valueOf(), tgtMetadata);
            await this.deleteFile(fileName);
            this.muestraLogTiempo(t00, "Importación de " + fileName + " finalizada");
        } catch(error) {            
            console.error("Error importando " + fileName, error);
            throw error;
        }
    }
}

module.exports = DescargaPronostico;