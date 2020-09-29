'use strict';

module.exports.setProgrammingMode = (req, res) => {
    global.module.setProgrammingMode()
        .then( (data) => {
            res.json( { data: devices, result : 'ok'  } );
        })
        .catch( (err) => {
            res.status(500).json( { code: err.code || 0, message: err.message } );
        });
};

