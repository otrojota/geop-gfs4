# docker run -d --mount type=bind,source=/Volumes/JSamsung/geoportal/gfs4/data,target=/home/data otrojota/geoportal:gfs4-downloader
FROM otrojota/geoportal:gdal-nodejs
WORKDIR /opt/geoportal/geop-gfs4
COPY . .
RUN npm install 
CMD node index.js -download