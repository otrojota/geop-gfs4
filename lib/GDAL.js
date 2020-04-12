const config = require("./Config").getConfig();
const { exec } = require('child_process');
const fs = require("fs");
const dbg = require("./Debug");

class GDAL {
    static get instance() {
        if (GDAL.singleton) return GDAL.singleton;
        GDAL.singleton = new GDAL();
        return GDAL.singleton;
    }

    info(path, includeMM) {
        return new Promise((resolve, reject) => {
            let cmd = "gdalinfo" + " " + path + " -json" + (includeMM?" -mm":"");
            exec(cmd, {maxBuffer:1024 * 1024}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve(JSON.parse(stdout));
                }
            });
        });
    }
    coordenadasProjection(lng0, lat0, lng1, lat1) {
        let west = lng0;
        if (west < 0) west += 360;
        let east = lng1;
        if (east < 0) east += 360;
        
        let south = lat0;
        let north = lat1;
        return {w:west, n:north, e:east, s:south}
    }
    translateWindow(lng0, lat0, lng1, lat1, srcFile, dstFile, bandNumbers, outsize) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_translate -q -projwin " + lng0 + " " + lat1 + " " + lng1 + " " + lat0;
            bandNumbers.forEach(b => cmd += " -b " + b);
            if (outsize) {
                cmd += " -outsize " + (outsize.width) + " " + (outsize.height);
            }
            cmd += " " + srcFile + " " + dstFile;
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) {
                        // reject(stderr);
                        console.log("GDAL Translate para " + dstFile + ". Se recibe error o advertencia:" + stderr + " ... se ignora");
                    }
                    resolve();
                }
            });
        });        
    }
    translate(srcFile, dstFile, bandNumbers) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_translate -q";
            bandNumbers.forEach(b => cmd += " -b " + b);
            cmd += " " + srcFile + " " + dstFile;
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });        
    }

    isolineas(srcFile, outFile, increment) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_contour -a value -i " + increment + " " + srcFile + " " + outFile;
            let op = dbg.start(cmd);
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    dbg.end(op);
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });
    }

    isobandas(srcFile, outFile, increment) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_contour -amin minValue -amax maxValue -p -i " + increment + " " + srcFile + " " + outFile;
            let op = dbg.start(cmd);
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    dbg.end(op);
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });
    }

    calc(variables, outFile, formula) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_calc.py";
            variables.forEach(v => cmd += " -" + v.codigo + " " + v.path);
            cmd += " --outfile=" + outFile + " --calc=\"" + formula + "\" --quiet";
            exec(cmd, {maxBuffer:1024 * 10}, (err, stdout, stderr) => {
                if (err) reject(err);
                else {
                    if (stderr) reject(stderr);
                    else resolve();
                }
            });
        });
    }

    getRegularMatrix(lng0, lat0, lng1, lat1, file, band, resolution, tmpPath) {
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -projwin " + lng0 + " " + lat1 + " " + lng1 + " " + lat0;
            cmd += " -b " + band;
            cmd += " -outsize " + resolution + " " + resolution;
            cmd += " -of AAIGrid";
            cmd += " -r bilinear";
            cmd += " " + file + " " + tmpFileName + ".tmp";
            exec(cmd, {maxBuffer:1024 * 1024 * 10}, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.readFile(tmpFileName + ".tmp", (err, data) => {
                    let lines = data.toString().split("\n");
                    let retData = [];
                    for (let i=lines.length - 1; i >= 6; i--) {
                        //lines[i].split(" ").forEach(v => retData.push(parseFloat(v)));
                        let line = lines[i];
                        if (line.trim()) {
                            let cols = line.split(" ");
                            cols.forEach(v => {
                                if (v.trim()) retData.push(parseFloat(v))
                            });
                        }
                    }
                    fs.unlink(tmpFileName + ".prj", _ => {});
                    fs.unlink(tmpFileName + ".tmp", _ => {});
                    fs.unlink(tmpFileName + ".tmp.aux.xml", _ => {});
                    resolve(retData);
                });
            });
        });        
    }

    getRectangularMatrix(lng0, lat0, lng1, lat1, file, band, width, height, tmpPath) {
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -projwin " +lng0 + " " + lat1 + " " + lng1 + " " + lat0;
            if (band !== undefined && band !== null) cmd += " -b " + band;
            if (width !== undefined && width !== null && height !== undefined && height !== null) cmd += " -outsize " + (width) + " " + (height);
            cmd += " -of AAIGrid";
            cmd += " " + file + " " + tmpFileName + ".tmp";
            exec(cmd, {maxBuffer:1024 * 1024 * 10}, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.readFile(tmpFileName + ".tmp", (err, data) => {
                    let lines = data.toString().split("\n");
                    try {
                        let data = this.parseLines(lines);
                        resolve(data);
                    } catch(error) {
                        reject(error);
                    } finally {
                        fs.unlink(tmpFileName + ".prj", _ => {});
                        fs.unlink(tmpFileName + ".tmp", _ => {});
                        fs.unlink(tmpFileName + ".tmp.aux.xml", _ => {});
                    }
                });
            });
        });        
    }

    parseLines(lines) {
        let ret = {rows:[], min:undefined, max:undefined};
        lines.forEach(l => {
            if (l.trim().length > 0) {
                let fields = l.trim().split(" ").filter(v => v.trim().length > 0);
                if (fields.length) {
                    let fieldName = fields[0];
                    if (!isNaN(parseFloat(fieldName))) {
                        let row = [];
                        ret.rows.push(row);
                        // row or single value
                        fields.forEach(field => {
                            let value = parseFloat(field);                            
                            if (isNaN(value)) throw "Formato de linea inválido\n" + l;
                            ret.value = value;
                            row.push(value);
                            if (ret.min === undefined || value < ret.min) ret.min = value;
                            if (ret.max === undefined || value > ret.max) ret.max = value;
                        });
                    } else {
                        // field = value
                        if (fields.length != 2) throw "Formato inválido para linea\n" + l + ".\n Se esperaba campo valor_numerico";
                        let value = parseFloat(fields[1]);
                        if (isNaN(value)) throw "Formato inválido para linea\n" + l + ".\n Se esperaba campo valor_numerico";
                        ret[fieldName] = value;
                    }
                }
            }
        });
        // invertir filas
        let swap = [];
        for (let i=ret.rows.length - 1; i>=0; i--) swap.push(ret.rows[i]);
        ret.rows = swap;
        return ret;
    }
    getPointValue(lng, lat, file, band, tmpPath) {
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -projwin " + (lng - 0.1) + " " + (lat + 0.1) + " " + (lng + 0.1) + " " + (lat - 0.1);
            if (band !== null && band !== undefined) cmd += " -b " + band;
            cmd += " -outsize " + 1 + " " + 1;
            cmd += " -of AAIGrid";
            cmd += " -r bilinear";
            cmd += " " + file + " " + tmpFileName + ".tmp";
            exec(cmd, {maxBuffer:1024 * 1024 * 10}, (err, stdout, stderr) => {
                if (err) {
                    reject(err);
                    return;
                }
                fs.readFile(tmpFileName + ".tmp", (err, data) => {
                    let lines = data.toString().split("\n");
                    let fields = this.parseLines(lines);                   
                    fs.unlink(tmpFileName + ".prj", _ => {});
                    fs.unlink(tmpFileName + ".tmp", _ => {});
                    fs.unlink(tmpFileName + ".tmp.aux.xml", _ => {});
                    if (fields.value === undefined || fields.value == fields.NODATA_value) reject("Sin Datos");
                    else resolve(fields.value);
                });
            });
        });        
    }
}

module.exports = GDAL.instance;