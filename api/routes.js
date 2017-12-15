'use strict'

var moment = require('moment');

module.exports = function (ctx) {

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
        const data = Object.assign({}, req.body, {
            created: new Date(),
            updated: new Date()
        })

        // insert one object into data collection
        collection.insertOne(data)
            .then(doc => res.send(200, doc.ops[0]))
            .catch(err => res.send(500, err))

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
        sort[sortKey] = sortOrder === 'asc' ? 1 : -1,
        // find data and convert to array (with optional query, skip and limit)
        collection.find(query).sort(sort)
            .skip(skip).limit(limit).toArray()
            .then(docs => res.send(200, docs))
            .catch(err => res.send(500, err))

        next()

    })

    /**
     * Update
     */
    server.put('/places/:id', (req, res, next) => {

        // extract data from body and add timestamps
        const data = Object.assign({}, req.body, {
            updated: new Date()
        })

        // build out findOneAndUpdate variables to keep things organized
        let query = {
                _id: req.params.id
            },
            body = {
                $set: data
            },
            opts = {
                returnOriginal: false,
                upsert: true
            }

        // find and update document based on passed in id (via route)
        collection.findOneAndUpdate(query, body, opts)
            .then(doc => res.send(204))
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

}