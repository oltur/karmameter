'use strict'

var moment = require('moment');
var axios = require('axios');

const {Client} = require("@googlemaps/google-maps-services-js");

module.exports = function (ctx) {

    const LIMIT = 20;
    const client = new Client({});

    // extract context from passed in object
    const db = ctx.db,
        server = ctx.server

    // assign collection to variable for further use
    const collection = db.collection('places')

    // /**
    //  * Import data
    //  */
    // server.post('/import', (req, res, next) => {

    //     let data = [];
    //     req.body.forEach((elem) => {

    //         // extract data from body and add timestamps
    //         const dataItem = Object.assign({}, elem, {
    //             created: new Date(),
    //             updated: new Date()
    //         })

    //         let day = moment.utc(dataItem.start_date, "MM/DD/YYYY");
    //         dataItem.start_date = day.toDate();

    //         day = moment.utc(dataItem.end_date, "MM/DD/YYYY");
    //         dataItem.end_date = day.toDate();

    //         data.push(dataItem);
    //     });
    //     collection.insertMany(data)
    //         .then(doc => res.send(200, "OK"))
    //         .catch(err => res.send(500, err))
    //         .then(() => next());
    // });

    /**
     * Create
     */
    server.post('/places', (req, res, next) => {

        // extract data from body and add timestamps
        const data = Object.assign({}, req.body)

        createPlaceIfNotExists(data, res)
            .then(doc => res.send(200, doc))
            .catch(err => res.send(500, err))

        next()

    })

    server.get('/places/photo', async (req, res, next) => {
        const photoRef = req.query.ref;
        const maxwidth = parseInt(req.query.maxwidth, 10) || 220;
        if (!photoRef) {
            res.send(400, { message: 'missing ref' });
            next();
            return;
        }
        try {
            const r = await axios.get('https://maps.googleapis.com/maps/api/place/photo', {
                params: {
                    photoreference: photoRef,
                    maxwidth: maxwidth,
                    key: process.env.GOOGLE_MAPS_API_KEY
                },
                responseType: 'arraybuffer'
            });
            res.writeHead(200, {
                'Content-Type': r.headers['content-type'] || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400'
            });
            res.end(r.data);
            next();
        } catch (err) {
            console.log('places/photo failed:', err.message);
            res.send(502, { message: 'photo fetch failed' });
            next();
        }
   })

    server.get('/places/:id', (req, res, next) => {
        next()
    })

    /**
     * Read
     * Example: http://localhost:3000/places?sortKey=city&sortOrder=asc&skip=0&limit=1000&$where=this.end_date>=ISODate('2014-01-01')%26%26this.start_date<=ISODate('2015-01-01')%26%26this.start_date<=this.end_date
     */
    server.get('/places', (req, res, next) => {

        let limit = parseInt(req.query.limit, 10) || 10, // default limit to 10 docs
            skip = parseInt(req.query.skip, 10) || 0, // default skip to 0 docs
            sortKey = req.query.sortKey,
            sortOrder = req.query.sortOrder,
            query = req.query || {}

        // remove skip and limit from query to avoid false querying
        delete query.skip
        delete query.limit
        delete query.sortKey;
        delete query.sortOrder;

        const sort = {};
        return getPlaces(sortKey, sortOrder, query, skip, limit)
            .then(docs => {
                updatePlacesForRetrieve(docs)
                res.send(200, docs)
            })
            .catch(err => res.send(500, err))

        next()

    })

    /**
     * Update
     */
    server.put('/places/:id', (req, res, next) => {

        // extract data from body and add timestamps
        const data = Object.assign({}, req.body)

        // find and update document based on passed in id (via route)
        updatePlace(req.params.id, data)
            .then(doc => res.send(200, doc))
            .catch(err => res.send(500, err))

        next()

    })

    /**
     * Delete
     */
    server.del('/places/:id', (req, res, next) => {

        // remove one document based on passed in id (via route)
        collection.findOneAndDelete({
                _id: req.params.id
            })
            .then(doc => res.send(204))
            .catch(err => res.send(500, err))

        next()

    })

        /**
     * Delete all
     */
    server.del('/places', (req, res, next) => {

        // remove all documents
        collection.remove({})
            .then(doc => res.send(204))
            .catch(err => res.send(500, err))

        next()

    })


    server.get('/nearbySearch', async (req, res, next) => {

        let location = {};
        location.lat = parseFloat(req.query.lat) || 51.123132;
        location.lng = parseFloat(req.query.lng) || 6.902079;
        let radius = parseInt(req.query.radius) || 1000;
        let type = req.query.type || "restaurant";
        let googleQueried = false;

        try {
            while(true) {
                var docs = await collection.aggregate([
                    {
                    $geoNear: {
                        near: { type: "Point", coordinates: [ location.lat , location.lng] },
                        distanceField: "dist.calculated",
                        maxDistance: radius,
                        query: { types: type },
                        includeLocs: "dist.location",
                        spherical: true
                        }
                    },
                    { $limit: LIMIT },
                    // { $match: { "dist.calculated": { $lt: radius } } },
                ]).toArray();
                if(!googleQueried && (!docs || docs.length < LIMIT - 5))
                {
                    try {
                        var r = await client.placesNearby({
                            params: {
                                location: location,
                                radius: radius,
                                type: type,
                                key: process.env.GOOGLE_MAPS_API_KEY
                            },
                            timeout: 10000, // milliseconds
                        })
                        await Promise.all(r.data.results.map((place) => {
                            return getPlaceDetailsAndCreatePlaceIfNotExists(place.place_id)
                            }))
                            googleQueried = true;
                    }
                    catch(err) {
                        console.log('nearbySearch google fallback failed:', (err.response && err.response.data && err.response.data.error_message) || err.message);
                        updatePlacesForRetrieve(docs || []);
                        res.send(200, docs || []);
                        next()
                        return
                    };
                } else {
                    updatePlacesForRetrieve(docs)
                    res.send(200, docs)
                    next()
                    return
                }
            }
        } catch (err) {
            console.log('nearbySearch failed:', err.message);
            res.send(500, { message: err.message });
            next();
            return;
        }
   })

   server.get('/elevation', (req, res, next) => {
        let location = {};
        location.lat = req.query.lat || 51;
        location.lng = req.query.lng || 7;

        client
        .elevation({
            params: {
                locations: [location],
                key: process.env.GOOGLE_MAPS_API_KEY
        },
            timeout: 10000, // milliseconds
        })
        .then((r) => {
            res.send(200, r.data.results[0].elevation);
        })
        .catch((e) => {
            console.log(e.response.data.error_message);
        });

        next()
    })

    function getPlaceDetailsAndCreatePlaceIfNotExists(googlePlaceId) {
        return getPlaceDetails(googlePlaceId)
            .then((place) => {
                return createPlaceIfNotExists(place);
            })
            .then(place => {
                console.log(place);
                return place;
            })
    }

    function getPlaceDetails(googlePlaceId) {
        return client
            .placeDetails({
                params: {
                    place_id: googlePlaceId,
                    key: process.env.GOOGLE_MAPS_API_KEY
                },
                timeout: 10000, // milliseconds
            })
            .then((place) => {
                return place.data.result;
            })
    }``

    function updatePlaceForCreate(place) {
        Object.assign(place, {
            created: new Date(),
            updated: new Date(),
            karmameter_reviews: [] // should contain rating
        })
        if(!('createdBy' in place) || !place.createdBy) {
            place.createdBy = "TBD";
        }
        if(!('updatedBy' in place) || !place.updatedBy) {
            if(place.createdBy) {
                place.updatedBy = place.createdBy;
            } else {
                place.updatedBy = "TBD";
            }
        }
        addGeospatial(place)
        return place 
    }

    function updatePlaceForUpdate(place) {
        Object.assign(place, {
            updated: new Date(),
            updatedBy: "TBD",
        })
        addGeospatial(place)
        delete place._id
        return place 
    }

    async function createPlaceIfNotExists(place) {
        if(place) {
            const existing = await collection.findOne({place_id: place.place_id});
            if(existing) {
                // TODO: Update
                return Promise.resolve(existing);
            }
        }
        // insert one object into data collection
        updatePlaceForCreate(place)
        return collection.insertOne(place)
            .then(x => x.ops[0]);
    }

    function updatePlace(place_id, place) {
        try {
            updatePlaceForUpdate(place)
        } catch (err) {
            return Promise.reject(err);
        }
        // build out findOneAndUpdate variables to keep things organized
        let query = {
            place_id: place_id
        },
        body = {
            $set: place,
        },
        opts = {
        }

        // find and update document based on passed in id (via route)
        const t = collection.findOneAndUpdate(query, body, opts)
        return t;
    }

    function addGeospatial(place) {
        if(!place.hasOwnProperty("location") && place.geometry && place.geometry.location) {
            const objLocation = {
                "location": {
                    "coordinates": [place.geometry.location.lat, place.geometry.location.lng],
                    "type":"Point"
                }
            }
            Object.assign(place, objLocation)
        }
    }

    /**
     * Example: http://localhost:3000/places?sortKey=city&sortOrder=asc&skip=0&limit=1000&$where=this.end_date>=ISODate('2014-01-01')%26%26this.start_date<=ISODate('2015-01-01')%26%26this.start_date<=this.end_date
     */
    function getPlaces(sortKey, sortOrder, query, skip, limit) {
        const sort = {};
        sort[sortKey] = sortOrder === 'asc' ? 1 : -1
        // find data and convert to array (with optional query, skip and limit)
        return collection.find(query).sort(sort)
            .skip(skip).limit(limit).toArray()
    }

    function updatePlacesForRetrieve(docs) {
        for(const place of docs) {
            if(!place.reviews) {
                place.reviews = []
            }
            if(!place.karmameter_reviews) {
                place.karmameter_reviews = []
            }
            const all_reviews = place.reviews.map(review => ({ rating: review.rating, weight: 1 }))
                .concat(place.karmameter_reviews.map(review => ({ rating: review.rating, weight: 10 })))
            const sumWeights = all_reviews.reduce(function(prev, cur) {
                return prev + cur.weight;
              }, 0);
            place.average_rating = all_reviews && all_reviews.length ?
            all_reviews.reduce((total, review) => (total || 0) + parseFloat(review.rating) * review.weight, 0) / sumWeights 
                : -1;
        }
    }
}


