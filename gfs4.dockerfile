# docker run --mount type=bind,source=/Volumes/JSamsung/geoportal/gfs4/data,target=/home/data --mount type=bind,source=/Volumes/JSamsung/geoportal/gfs4/publish,target=/home/publish otrojota/geoportal:gfs4
FROM otrojota/geoportal:gdal-nodejs
WORKDIR /opt/geoportal/geop-gfs4
COPY . .
RUN npm install 
CMD node index.js