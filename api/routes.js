'use strict'

var moment = require('moment');
var axios = require('axios');
var fs = require('fs');
var fsp = require('fs').promises;
var path = require('path');
var crypto = require('crypto');

const {Client} = require("@googlemaps/google-maps-services-js");

module.exports = function (ctx) {

    const LIMIT = 20;
    const client = new Client({});

    // extract context from passed in object
    const db = ctx.db,
        server = ctx.server

    // assign collection to variable for further use
    const collection = db.collection('places')

    // --- Nearby-search cache -------------------------------------------
    // Records that we have ALREADY asked Google about a given area, so the
    // fallback in /nearbySearch doesn't ask again for a week.
    //
    // Without this, the `docs.length < LIMIT - 5` condition below means any
    // area holding fewer than 15 places of the requested type hits the
    // Places API on EVERY request - every page load, every slider move,
    // every category change - because a sparse area can never satisfy the
    // condition no matter how many times we fetch it. Rural locations
    // therefore re-billed a Nearby Search plus up to 20 Place Details calls
    // indefinitely.
    const nearbyCache = db.collection('nearby_cache')
    const NEARBY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
    // ~110m grid. Centres are rounded onto it so that coming back to roughly
    // the same spot reuses the entry instead of minting a new key per metre
    // of GPS jitter.
    const NEARBY_CACHE_GRID_DECIMALS = 3

    // Mongo expires the documents itself; the explicit fetchedAt check in
    // hasFreshNearbySearch is what actually governs behaviour, this just
    // stops the collection growing forever.
    nearbyCache.createIndex(
        { fetchedAt: 1 },
        { expireAfterSeconds: Math.floor(NEARBY_CACHE_TTL_MS / 1000) }
    ).catch((err) => console.log('nearby_cache TTL index not created:', err.message))

    function nearbyGrid(value) {
        return parseFloat(value.toFixed(NEARBY_CACHE_GRID_DECIMALS))
    }

    // --- Place photo cache ----------------------------------------------
    // Every marker tooltip and every vote overlay fetches a photo through
    // /places/photo, which is a billable Places Photo call each time. The
    // route already sets a browser Cache-Control, but that only helps a
    // repeat view in the SAME browser - a new visitor, a new device or a
    // cleared cache re-bought the identical image. These files never change
    // for a given photo reference, so they are cached on disk here and the
    // Google call is made once per photo per TTL.
    //
    // Lives inside the api directory, which deploys only ever scp new files
    // into - so the cache survives deploys and pm2 restarts.
    const PHOTO_CACHE_DIR = path.join(__dirname, '.photo-cache')
    // 30 days. Google's Maps Platform terms allow temporary caching of
    // content for a limited period (place IDs being the long-lived
    // exception); worth re-checking against the current terms if this is
    // ever raised much higher.
    const PHOTO_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
    // Content type is recovered from the file extension, so no sidecar
    // metadata file is needed.
    const PHOTO_EXT_TYPES = {
        jpg: 'image/jpeg',
        png: 'image/png',
        webp: 'image/webp',
        gif: 'image/gif'
    }

    try {
        fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true })
    } catch (err) {
        console.log('photo cache dir not created:', err.message)
    }

    function photoCacheKey(photoRef, maxwidth) {
        // Hashed, so the (attacker-supplied) reference can never influence
        // the path - the filename is always plain hex.
        return crypto.createHash('sha1').update(`${photoRef}|${maxwidth}`).digest('hex')
    }

    function photoExtFor(contentType) {
        const match = Object.keys(PHOTO_EXT_TYPES)
            .find((ext) => PHOTO_EXT_TYPES[ext] === contentType)
        return match || 'jpg'
    }

    async function readPhotoCache(key) {
        for (const ext of Object.keys(PHOTO_EXT_TYPES)) {
            const file = path.join(PHOTO_CACHE_DIR, `${key}.${ext}`)
            try {
                const stat = await fsp.stat(file)
                if (Date.now() - stat.mtimeMs > PHOTO_CACHE_TTL_MS) {
                    await fsp.unlink(file).catch(() => {})
                    return null
                }
                return { data: await fsp.readFile(file), contentType: PHOTO_EXT_TYPES[ext] }
            } catch (err) {
                // Not cached under this extension - try the next.
            }
        }
        return null
    }

    async function writePhotoCache(key, contentType, data) {
        const ext = photoExtFor(contentType)
        const finalPath = path.join(PHOTO_CACHE_DIR, `${key}.${ext}`)
        const tempPath = `${finalPath}.${process.pid}.tmp`
        try {
            // Write-then-rename: rename is atomic, so a concurrent request
            // can never read a half-written image.
            await fsp.writeFile(tempPath, data)
            await fsp.rename(tempPath, finalPath)
        } catch (err) {
            console.log('photo cache write failed:', err.message)
            await fsp.unlink(tempPath).catch(() => {})
        }
    }

    async function hasFreshNearbySearch(location, radius, type) {
        try {
            const entry = await nearbyCache.findOne({
                gridLat: nearbyGrid(location.lat),
                gridLng: nearbyGrid(location.lng),
                type: type,
                // A previous search over a WIDER radius already covers this
                // one, so narrowing the distance slider doesn't re-query.
                radius: { $gte: radius },
                fetchedAt: { $gt: new Date(Date.now() - NEARBY_CACHE_TTL_MS) }
            })
            return !!entry
        } catch (err) {
            // Never let a cache failure stop the request - fall through to
            // the old behaviour instead.
            console.log('nearby_cache lookup failed:', err.message)
            return false
        }
    }

    async function recordNearbySearch(location, radius, type, resultCount) {
        const gridLat = nearbyGrid(location.lat)
        const gridLng = nearbyGrid(location.lng)
        try {
            await nearbyCache.updateOne(
                { _id: `${gridLat},${gridLng},${radius},${type}` },
                {
                    $set: {
                        gridLat: gridLat,
                        gridLng: gridLng,
                        radius: radius,
                        type: type,
                        resultCount: resultCount,
                        fetchedAt: new Date()
                    }
                },
                { upsert: true }
            )
        } catch (err) {
            console.log('nearby_cache write failed:', err.message)
        }
    }

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
        const cacheKey = photoCacheKey(photoRef, maxwidth);
        const cached = await readPhotoCache(cacheKey);
        if (cached) {
            res.writeHead(200, {
                'Content-Type': cached.contentType,
                'Cache-Control': 'public, max-age=86400',
                'X-Photo-Cache': 'HIT'
            });
            res.end(cached.data);
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
            const contentType = r.headers['content-type'] || 'image/jpeg';
            const body = Buffer.from(r.data);
            // Serve first, persist after - a cache write problem must never
            // delay or break the response.
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
                'X-Photo-Cache': 'MISS'
            });
            res.end(body);
            next();
            await writePhotoCache(cacheKey, contentType, body);
            return;
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
            // Already asked Google about this area within the TTL - serve
            // whatever we stored last time and skip the billable call
            // entirely, however few results that turns out to be.
            const alreadySearched = await hasFreshNearbySearch(location, radius, type);
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
                if(!googleQueried && !alreadySearched && (!docs || docs.length < LIMIT - 5))
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
                            // Record BEFORE looping back round, so this area
                            // is marked searched even if it yielded nothing.
                            // That empty case is precisely the one that used
                            // to re-bill on every single request.
                            await recordNearbySearch(location, radius, type, r.data.results.length);
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

    async function getPlaceDetailsAndCreatePlaceIfNotExists(googlePlaceId) {
        // Check our own copy FIRST. This previously fetched Place Details and
        // only then asked whether the place already existed - so every place
        // we already had still cost a billable Details call whose result was
        // thrown away, up to 20 of them per nearby search. Place Details is
        // charged per call regardless of whether we keep the answer.
        const existing = await collection.findOne({ place_id: googlePlaceId })
        if (existing) {
            return existing
        }
        const place = await getPlaceDetails(googlePlaceId)
        return createPlaceIfNotExists(place)
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


