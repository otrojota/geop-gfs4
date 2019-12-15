const config = require("./Config").getConfig();
const { exec } = require('child_process');
const fs = require("fs");

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
    translateWindow(w,n,e,s, srcFile, dstFile, bandNumbers) {
        return new Promise((resolve, reject) => {
            let cmd = "gdal_translate -q -projwin " + w + " " + n + " " + e + " " + s;
            bandNumbers.forEach(b => cmd += " -b " + b);
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
    getRegularMatrix(w,n,e,s, file, band, resolution, tmpPath) {
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -projwin " + w + " " + n + " " + e + " " + s;
            cmd += " -b " + band;
            cmd += " -outsize " + (resolution + 1) + " " + (resolution + 1);
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

    getRectangularMatrix(w,n,e,s, file, band, width, height, tmpPath) {
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -projwin " + w + " " + n + " " + e + " " + s;
            cmd += " -b " + band;
            cmd += " -outsize " + (width) + " " + (height);
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

    getPointValue(lng, lat, file, band, tmpPath) {
        return new Promise((resolve, reject) => {
            let tmpFileName = tmpPath + "/tmp_" + parseInt(1000000 * Math.random());
            let cmd = "gdal_translate -q -projwin " + lng + " " + lat + " " + (lng + 0.1) + " " + (lat - 0.1);
            cmd += " -b " + band;
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
                    let ret = parseFloat(lines[5].trim());
                    fs.unlink(tmpFileName + ".prj", _ => {});
                    fs.unlink(tmpFileName + ".tmp", _ => {});
                    fs.unlink(tmpFileName + ".tmp.aux.xml", _ => {});
                    resolve(ret);
                });
            });
        });        
    }
}

module.exports = GDAL.instance;