const api_url = 'https://www.reddit.com'
const auth_url = 'https://www.reddit.com/api/v1/access_token'

const apiRequest = (method, url, auth, params, callback) => {

	if (!auth) params.client_id = settings.clientIds.reddit.client_id
	params.format = 'json'

	let urlParameters = Object.keys(params).map((i) => typeof params[i] !== 'object' ? i+'='+params[i]+'&' : '' ).join('') // transforms to url format everything except objects

	if (!url.includes('https://')) url = api_url+url

	let requestOptions = { url: url+'?'+urlParameters, method: method, json: true, headers: { 'User-Agent': 'Harmony Player'}}
	
	if (auth)  {
		requestOptions.url = requestOptions.url.replace('www.', 'oauth.')
		requestOptions.headers.Authorization= 'bearer '+settings.reddit.access_token
	} else {
		requestOptions.auth = {user: settings.clientIds.reddit.client_id, pass: ''}
	}

	if (method !== 'GET') requestOptions.json = params

	request(requestOptions, (err, result, body) => {
		//console.log(err, body)
		if (body && body.error) callback(body.error, body)
		else callback(err, body)
	})
	
}

const auth = (code, callback) => {

	apiRequest('POST', auth_url, false, {

		grant_type: 'authorization_code',
		redirect_uri: 'http://localhost',
		code: code

	}, (err, res) => {
		callback(err, res)
	})

}

const refreshToken = (callback) => {
	apiRequest('POST', auth_url, false, {
		grant_type: 'refresh_token',
		redirect_uri: 'http://localhost',
		refresh_token: settings.reddit.refresh_token
	}, (err, res) => {
		if (err) return callback(err)
		settings.reddit.access_token = res.access_token
		callback(err)
	})
}

const convertTrack = rawTrack => {

	let title = rawTrack.title.split(" - ")[1].replace(/(\[.*?\])/g, '') // Remove things like [fresh] or [new]
	let artist = rawTrack.title.split(" - ")[0].replace(/(\[.*?\])/g, '')

	return {
		'service': 'reddit',
		'title': title,
		'artist': {
			'id': artist,
			'name': artist 
		},
		'album': {
			'id': '',
			'name': ''
		},
		'share_url': rawTrack.url,
		'id': rawTrack.name,		
		'artwork': rawTrack.thumbnail != '' ? rawTrack.thumbnail : rawTrack.media.oembed.thumbnail_url,
		'url': rawTrack.url
	}
}


/**
* Reddit API Abstraction
*/
class Reddit {

	/**
	* Fetch data
	*
	* @returns {Promise}
	*/
	static fetchData (callback) {

		if (!settings.reddit.access_token) {
			settings.reddit.error = true
			return callback([null, true])
		}

		refreshToken(err => {

			if (err) {
				settings.reddit.error = true
				return callback([err, true])
			}

			apiRequest('GET', `/user/${settings.reddit.username}/upvoted`, true, {}, (err, result) => {
				if (err) return callback([err])

				let tempTracks = []

				for (let submission of result.data.children) {
					if (submission.data.media && submission.data.title.includes(' - ') && (submission.data.media.type.includes('soundcloud') || submission.data.media.type.includes('youtube') )) {
						tempTracks.push(convertTrack(submission.data))
					}
				}

				Data.addPlaylist({
					service: 'reddit',
					title: 'Upvoted',
					icon: 'up-open',
					id: 'upvotes',
					tracks: tempTracks
				})

				let subreddits = settings.reddit.subreddits.split(',')

				for (let i = 0; i < subreddits.length; i++) {

					let subreddit = subreddits[i]

					apiRequest('GET', `https://www.reddit.com/r/${subreddit}/.json`, false, {limit: 100}, (err, result) => {

						if (err) return callback([err])

						let tempTracks = []

						for (let submission of result.data.children) {

							if ((submission.data.media && submission.data.title && submission.data.media.type ) 
								&& submission.data.title.includes(' - ') 
								&& (submission.data.media.type.includes('soundcloud') || submission.data.media.type.includes('youtube') )) {

								tempTracks.push(convertTrack(submission.data))
							}
						}

						Data.addPlaylist({
							service: 'reddit',
							title: '/r/'+subreddit,
							id: subreddit,
							artwork: '',
							tracks: tempTracks
						})

						if (i >= (subreddits.length - 1)) {
							callback()

						}

					})

				}

			})

		})

	}


	/**
	 * Called when user wants to activate the service
	 *
	 * @param callback {Function} Callback function
	 */
	static login (callback) {

		const oauthUrl = `https://www.reddit.com/api/v1/authorize.compact?client_id=${settings.clientIds.reddit.client_id}&response_type=code&state=RANDOM_STRING&redirect_uri=http://localhost&duration=permanent&scope=identity save read mysubreddits vote history`
		oauthLogin(oauthUrl, (code) => {
			if (!code) return callback('stopped')

			auth( code, (err, data) => {
				if (err) return callback(err)

				settings.reddit.access_token = data.access_token
				settings.reddit.refresh_token = data.refresh_token

				apiRequest('GET', `/api/v1/me`, true, {}, (err, result) => {
					settings.reddit.username = result.name

					callback()
				})
			})

		})

	}

	/**
	 * Gets a track's streamable URL
	 *
	 * @param track {Object} The track object
	 * @param callback {Function} The callback function
	 */
	static getStreamUrl (track, callback) {
		if (track.url.includes('youtu')) {
			window['youtube'].getStreamUrlFromVideo(track.url, (err, url) => {
				callback(err, url, track.id)
			})
		} else if (track.url.includes('soundcloud')) {
			window['soundcloud'].resolveTrack(track.url, (err, scTrack) => {
				if (scTrack && scTrack.streamUrl) {
					callback(err, scTrack.streamUrl, track.id)
				} else {
					callback('No track/stream from SoundCloud for '+track.url, null, track.id)
				}
			})
		}
	}


	/**
	 * Like a song 
	 *
	 * @param track {Object} The track object
	 */
	static like (track, callback) {
		refreshToken(error => {
			apiRequest('POST', ` /api/vote`, true, {id: track.id, dir: 1}, (err, result) => {
				callback(error || err)
			})
		})

		if (!settings.reddit.mirrorLikes) return

		if (settings.soundcloud.active && track.url.includes('soundcloud')) {
			window['soundcloud'].resolveTrack(track.url, (err, track) => {
				if (err) callback(err)
				window['soundcloud'].like(track, callback)
			})
		} else if (settings.youtube.active && track.url.includes('youtu')) {
			window['youtube'].resolveTrack(track.url, (err, track) => {
				if (err) callback(err)
				window['youtube'].like(track, callback)
			})
		}
	}

	/**
	 * Unlike a song
	 *
	 * @param track {Object} The track object
	 */
	static unlike (track, callback) {
		refreshToken(error => {
			apiRequest('POST', `/api/vote`, true, {id: track.id, dir: 0}, (err, result) => {
				callback(error || err)
			})
		})

		if (!settings.reddit.mirrorLikes) return

		if (settings.soundcloud.active && track.url.includes('soundcloud')) {
			window['soundcloud'].resolveTrack(track.url, (err, track) => {
				if (err) callback(err)
				window['soundcloud'].unlike(track, callback)
			})
		} else if (settings.youtube.active && track.url.includes('youtu')) {
			window['youtube'].resolveTrack(track.url, (err, track) => {
				if (err) callback(err)
				window['youtube'].unlike(track, callback)
			})
		}
	}

	/*
	* Returns the settings items of this plugin
	*
	*/
	static settingsItems () {
		return [
			{
				type: 'activate',
				id: 'active'
			},
			{
				description: 'Subreddits to show',
				type: 'text',
				id: 'subreddits',
				placeholder: 'Separate by a coma, without /r/'
			},
			{
				description: 'If possible, also like on SoundCloud & YouTube',
				type: 'checkbox',
				id: 'mirrorLikes'
			}
		]
	}	

}


/** Static Properties **/
Reddit.favsPlaylistId = "upvotes"
Reddit.scrobbling = true
Reddit.settings = {
	active: false,
	subreddits: 'listentothis,futurebeats',
	mirrorLikes: true
}

module.exports = Reddit