// src/humtum/humtum.js

const auth = require('./auth-service');
const axios = require('axios');
WebSocket = require('ws')
const ActionCable = require('humtum-action-cable-react-jwt');

// HumTum lib should be unopinionated so should be decoupled from rest of
// app. (e.g., stores)
/**
 * Class helping to communicate with humtum-platform API.
 *
 * @class
 */
class HumTum {
  config = {
    apiUrl: "/",
    cacheExpiry: 10 * 60 * 1000, // 10 minutes. Set to 0 for no caching
    baseUrl: "http://localhost:3000"
  }

  auth;
  user;
  cable;
  userCache = {}; // { id: { model: model, expiration: Date } }
  appCache = {};

  setAuth = (a) => {
    this.auth = a
  }

  getAuth = () => {
    return this.auth
  }

  /**
   * Logout of Humtum
   * @method
   * @date 2020-06-10
   * @param {function} cb callback function to run when the log out is completed
   */
  logout = (cb) => {
    this.user = undefined;
    this.getAuth().logout(cb)
  }

  /**
   * check whether user is authenticated
   * @method
   * @date 2020-06-10
   * @param {function} authCB this function will run if the user is authenticated
   * @param {function} unauthCB this function will run if the user is not authenticated
   */
  checkAuth = (authCB, unauthCB) => {
    if (this.getAuth().isAuthenticated()) {
      authCB();
    } else {
      if (unauthCB) {
        unauthCB()
      }
    }
  }

  /**
   * get the action cable that is used for realtime messaging
   * @method
   * @date 2020-06-10
   * @returns {object} the action cable
   */
  getCable = () => {
    let generateCableToken = () => {
      const jwt = JSON.stringify({
        id_token: this.getAuth().getIDToken(),
        access_token: this.getAuth().getAccessToken()
      })
      if (typeof Buffer !== 'undefined')
        return Buffer.from(jwt, 'utf8').toString('base64').replace("=", "");
      else
        return window.btoa(jwt).replace(/=/g, "")
    }
    if (this.cable)
      return this.cable
    this.cable = ActionCable.createConsumer(`ws://localhost:3001/cable`, {
      origin: "http://localhost:3000",
      token: generateCableToken()
    })
    return this.cable
  }

  /**
   * subscribe to a websocket channel
   * @method
   * @date 2020-06-10
   * @param {string} channelName the websocket channel to subscribe to. This value can be "MessagesChannel" or "NotificationsChannel"
   * @param {function} onConnected callback function when users are connected to a channel
   * @param {function} onDisconnected callback function when users are disconnected to a channel
   * @param {function} onReceived callback function when users received a message
   * @param {object} params options to subscribe to a channel
   */
  subscribeToChannel = (channelName, onConnected, onDisconnected, onReceived, params) => {
    const init = {
      channel: channelName
    }

    if (params) {
      Object.keys(params).forEach((key) => {
        init[key] = params[key]
      })
    }

    console.log(init)

    this.getCable().subscriptions.create(
      init, {
        connected: onConnected,
        disconnected: onDisconnected,
        received: onReceived
      })
  }

  /**
   * set the base URL of the humtum-platform API server
   * @method
   * @date 2020-06-10
   * @param {string} baseUrl the base URL to connect to
   */
  setBaseUrl = (baseUrl) => {
    this.config['baseUrl'] = baseUrl
  }

  // Not secure right now...
  createRequestHeaders = (multipart = false) => {
    const headers = {
      'UserAuth': `Bearer ${this.getAuth().getIDToken()}`,
      'AccessAuth': `Bearer ${this.getAuth().getAccessToken()}`,
    }
    return multipart ? Object.assign(headers, {
      'Content-Type': 'multipart/form-data'
    }) : headers
  }

  printErr = (e) => {
    console.error(e)
  }

  /**
   * get your profile
   * @method
   * @date 2020-06-10
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} your profile
   */
  getSelf = async (err = this.printErr) => {
    if (this.user) return this.user;
    const url = '/users/self'
    this.user = await this.sendRequest(url, err)
    return this.user;
  }

  /**
   * send a message to an user
   * @method
   * @date 2020-06-10
   * @param {{
     description,
     payload,
     targets
   }}
   message message to be send
   * @param {any} err=this.printErr function to handle error
   * @returns {any} whether it is sucessful to run
   */
  createMessage = async (message, err = this.printErr) => {
    const url = `/messages`
    // The message requires these parameters
    const {
      description,
      payload,
      targets
    } = message
    const result = await this.sendRequest(url, err, {
      message: {
        description: description,
        payload: payload,
        targets: targets
      }
    }, "POST")
    return result;
  }


  /**
   * get the Message the user has received
   * @method
   * @data 2020-06-10
   * @param {{unread: boolean}} query 
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} an array of message
   */
  getMessage = async (query, err = this.printErr) => {
    const url = `/messages`
    return await this.sendRequest(url, err, query)
  }

  /**
   * mark message as received
   * @method
   * @date 2020-06-10
   * @param {string} id the id of the message
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  receiveMessage = async (id, err = this.printErr) => {
    const url = `/messages/${id}/receive`
    const result = await this.sendRequest(url, err, null, "PUT")
    return result;
  }


  /**
   * update the profile
   * @method
   * @date 2020-06-10
   * @param {any} name
   * @param {any} avatar
   * @param {function} err=this.printErr the callback function when error
   * @returns {any}
   */
  updateSelf = async (name, avatar, err = this.printErr) => {
    if (!this.user) {
      try {
        if (this.getAuth().isAuthenticated()) {
          this.user = await this.getSelf();
        } else {
          this.printErr(new Error("Need to authenticate first."))
        }
      } catch (e) {
        this.printErr(e);
      }
    }

    const url = `/users/${this.user.id}`
    const fd = new FormData()
    fd.append('user[name]', name)
    fd.append('user[avatar]', avatar)
    this.user = await this.sendMultipartRequest(url, err, fd, 'put')
    return this.user;
  }


  getModel = async (id, modelURL, cache, err) => {
    if (cache[id] && new Date().getTime() < cache[id].expiration) {
      return cache[id].model
    }

    const url = `/${modelURL}/${id}`
    const model = await this.sendRequest(url, err)

    cache[id] = {
      model: model,
      expiration: new Date().getTime() + this.config.cacheExpiry
    }

    return model
  }

  createNewModel = async (params, modelURL, cache, err = this.printErr) => {
    const url = `/${modelURL}`
    const model = await this.sendRequest(url, err, params, 'post')

    cache[model.id] = {
      model: model,
      expiration: new Date().getTime() + this.config.cacheExpiry
    }

    return model
  }

  /**
   * get user using id
   * @method
   * @date 2020-06-10
   * @param {string} id the id
   * @param {function} err=this.printErr the callback function when error 
   * @returns {Promise} the profile of the user
   */
  getUser = async (id, err = this.printErr) => {
    return await this.getModel(id, "users", this.userCache, err)
  }

  /**
   * search user using query
   * @method
   * @date 2020-06-10
   * @param {string} query
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  searchUsers = async (query, err = this.printErr) => {
    const url = `/users/search/${query}`
    return await this.sendRequest(url, err)
  }

  searchApps = async (query, authenticated = true, err = this.printErr) => {
    const url = `/apps/${authenticated ? "authenticated_" : ""}search/${query}`
    return await this.sendRequest(url, err)
  }

  getMyApps = async (err = this.printErr) => {
    const url = `/apps`
    return await this.sendRequest(url, err)
  }

  /**
   * enroll in the app
   * @method
   * @date 2020-06-10
   * @param {string} id the app id
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  enrollInApp = async (id, err = this.printErr) => {
    const url = `/apps/${id}/enroll`
    return await this.sendRequest(url, err, {}, 'post')
  }

  /**
   * unenroll in the app
   * @method
   * @date 2020-06-10
   * @param {string} id the app id
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  unenrollFromApp = async (id, err = this.printErr) => {
    const url = `/apps/${id}/unenroll`
    return await this.sendRequest(url, err, {}, 'delete')
  }

  getAppData = async (appID, dataPath, err) => {
    const url = `/apps/${appID}/${dataPath}`
    return await this.sendRequest(url, err)
  }

  searchAppData = async (appID, query, dataPath, err) => {
    const url = `/apps/${appID}/${dataPath}?q=${query}`
    return await this.sendRequest(url, err)
  }

  putRelRequest = async (appID, friendID, type, data, err = this.printErr) => {
    const url = `/relationships/${appID}/${type}/${friendID}`
    console.log(url)
    console.log({
      relationship_request: {
        ...data
      }
    })
    return await this.sendRequest(url, err, {
      relationship_request: {
        ...data
      }
    }, 'put')
  }
  _relRequestResponse = async (appID, friendID, friendOrFollow, response, err = this.printErr) =>
    await this.putRelRequest(appID, friendID, `respond_to_${friendOrFollow}_request`, {
      response: response
    }, err)

  /**
   * add a friend
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {string} friendID friend id to add
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  addFriend = async (appID, friendID, err = this.printErr) => await this.putRelRequest(appID, friendID, "add_friend", {}, err)
  /**
   * unfriend some one
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {string} friendID friend id to unfriend
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  unfriend = async (appID, friendID, err = this.printErr) => await this.putRelRequest(appID, friendID, "unfriend", {}, err)
  /**
   * approve a friend request
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {string} friendID friend id to approve request from
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  approveFriendRequest = async (appID, friendID, err = this.printErr) => await this._relRequestResponse(appID, friendID, "friend", "approve", err)
  /**
   * reject a friend request
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {string} friendID friend id to reject the request from
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  rejectFriendRequest = async (appID, friendID, err = this.printErr) => await this._relRequestResponse(appID, friendID, "friend", "reject", err)

  /**
   * follow someone
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {string} friendID friend id to follow
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  followOther = async (appID, friendID, err = this.printErr) => await this.putRelRequest(appID, friendID, "follow", {}, err)
  /**
   * unfollow someone
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {string} friendID friend id to unfollow
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  unfollow = async (appID, friendID, err = this.printErr) => await this.putRelRequest(appID, friendID, "unfollow", {}, err)
  /**
   * approve a follow request
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {any} followID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  approveFollowRequest = async (appID, followID, err = this.printErr) => await this._relRequestResponse(appID, followID, "follow", "approve", err)
  /**
   * reject a follow request
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {any} followID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  rejectFollowRequest = async (appID, followID, err = this.printErr) => await this._relRequestResponse(appID, followID, "follow", "reject", err)

  /**
   * get your friends
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  getFriends = async (appID, err = this.printErr) => await this.getAppData(appID, "friends", err)
  /**
   * get your friend requests
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  getFriendRequests = async (appID, err = this.printErr) => await this.getAppData(appID, "friend_requests", err)
  /**
   * get your followers
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  getFollowers = async (appID, err = this.printErr) => await this.getAppData(appID, "followers", err)
  /**
   * get your following
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  getFollowing = async (appID, err = this.printErr) => await this.getAppData(appID, "following", err)
  /**
   * get your follower requests
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  getFollowerRequests = async (appID, err = this.printErr) => await this.getAppData(appID, "follower_requests", err)
  /**
   * get your following requests
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  getFollowingRequests = async (appID, err = this.printErr) => await this.getAppData(appID, "following_requests", err)
  /**
   * get all the users in an app
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID to specify the app
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  getUsers = async (appID, err = this.printErr) => await this.getAppData(appID, "users", err)
  /**
   * search user in an app
   * @method
   * @date 2020-06-10
   * @param {string} appID the app ID to specify an app
   * @param {any} query
   * @param {function} err=this.printErr the callback function when error
   * @returns {Promise} the result
   */
  searchUsersInApp = async (appID, query, err = this.printErr) => await this.searchAppData(appID, query, "user_search", err)

  getAppUser = async (appID, uid, err = this.printErr) => {
    const url = `/apps/${appID}/user/${uid}`
    return await this.sendRequest(url, err)
  }


  sendRequest = async (url, err, data = {}, method = 'get') => {
    if (this.getAuth().getIDToken() && this.getAuth().getAccessToken()) {
      const headers = this.createRequestHeaders()
      try {
        const response = await axios({
          method: method,
          url: `${this.config['baseUrl']}${url}`,
          data: data,
          headers: headers
        })
        return response.data
      } catch (e) {
        err(e.response)
      }
    } else {
      err(new Error("Please configure your HumTum application credentials first."))
    }
    return null;
  }

  sendMultipartRequest = async (url, err, formData, method = 'post') => {
    if (this.getAuth().getIDToken() && this.getAuth().getAccessToken()) {
      const config = {
        headers: this.createRequestHeaders(true)
      }
      try {
        const response = (method === 'post' ? await axios.post(`${this.config['baseUrl']}${url}`, formData, config) : await axios.put(`${this.config['baseUrl']}${url}`, formData, config))
        return response.data
      } catch (e) {
        err(e.response)
      }
    } else {
      err(new Error("Please configure your HumTum application credentials first."))
    }
    return null;
  }
}

const singleton = new HumTum();
singleton.setAuth(auth)

module.exports = singleton
