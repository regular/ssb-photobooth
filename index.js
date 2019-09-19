const {join} = require('path')
const {execFile, exec} = require('child_process')
const fs = require('fs')
const url = require('url')

// sbot plugin interface
exports.name = 'photobooth'
exports.version = require('./package.json').version
exports.manifest = {
  sendMail: 'async'
}

exports.init = function (ssb, config) {
  const cfg = config.photobooth || {}

  const gphoto2Path = cfg.gphoto2Path || '/usr/bin/gphoto2'
  const mailPath = cfg.mailPath || '/usr/bin/mail'
  const urlPrefix = cfg.urlPrefix || '/photobooth/'
  const destDir = cfg.destDir || '/tmp'
  const {postProcessScript} = cfg

  ssb.ws.use((req, res, next) =>  {
    if(!(req.method === "GET" || req.method == 'HEAD')) return next()
    const u = url.parse('http://makeurlparseright.com'+req.url)

    if (!u.pathname.startsWith(urlPrefix)) {
      return next()
    }

    const photoId = u.pathname.substr(urlPrefix.length)
    const filename = join(destDir, photoId + '.jpg')
    const args = [
      '--capture-image-and-download',
      '--filename', filename,
      '--force-overwrite'
    ]
    console.log('Capturing to ', filename)
    try {fs.unlinkSync(filename)} catch(e) {}
    
    execFile(gphoto2Path, args, {}, (err, stdout, stderr) => {
      if (err) {
        console.error(err.message)
        console.error(stderr)
        res.statusCode = 503
        return res.end(stdout + '\n' + stderr)
      }
      let stats
      try {
        stats = fs.statSync(filename)
      } catch(e) {
        res.statusCode = 404
        return res.end(e.message)
      }
      res.setHeader('Content-Type', 'image/jpeg')
      res.setHeader('Content-Length', stats.size)
      res.statusCode = 200
      fs.createReadStream(filename).pipe(res)
    })
    return
  })

  function sendMail(photoId, opts, cb) {
    if (typeof photoId == 'object') {
      return cb(new Error('photoid must be a string'))
    }
    if (typeof opts == 'function') {
      cb = opts
      opts = {}
    }

    const subject = opts.subject || 'ssb-photobooth'
    const text = opts.text || 'A picture!'
    const recipient = opts.recipient || 'regular.gonzales@gmail.com'
    let filename = join(destDir, photoId + '.jpg')

    try {
      fs.statSync(filename)
    } catch(e) {
      return cb(e)
    }

    if (postProcessScript) {
      console.log(`exec ${postProcessScript} ${filename}`)
      exec(`${postProcessScript} ${filename}`, (err, stdout) =>{
        if (err) {
          console.error(err.message)
          return cb(err)
        }
        filename = stdout.trim()
        _sendMail(cb)
      })
    } else {
      console.log('No postProcessScript')
      _sendMail(cb)
    }

    function _sendMail(cb) {
      const args = [
        '-s', subject,
        '-a', filename,
        recipient
      ]

      const mail = execFile(mailPath, args, {}, err => {
        if (err) {
          console.error(err.message)
          return cb(err)
        }
        // might want to send more than once
        // try {fs.unlinkSync(filename)} catch(e) {}
        return cb(null)
      })
      mail.stdin.write(text)
      mail.stdin.end()
    }
  }

  return {
    sendMail
  }
}
