# docker run --mount type=bind,source=/Volumes/JSamsung/geoportal/gfs4/data,target=/home/data --mount type=bind,source=/Volumes/JSamsung/geoportal/gfs4/publish,target=/home/publish otrojota/geoportal:gfs4
#
#
# docker build -f gfs4.dockerfile -t otrojota/geoportal:gfs4-0.31 .
# docker push otrojota/geoportal:gfs4-0.31
#

FROM otrojota/geoportal:gdal-nodejs-1.01
WORKDIR /opt/geoportal/geop-gfs4
COPY . .
RUN npm install 
EXPOSE 8181
CMD node index.js