/**
 * Tacion v0.1.3
 *  A jQuery Mobile framework for creating real-time presentations
 *  http://azoff.github.com/tacion.js
 *
 * Copyright 2012, Jonathan Azoff
 * Dual licensed under the MIT or GPL Version 2 licenses.
 *  http://jquery.org/license
 *
 * For usage and documentation, see the README file
 *  http://azof.fr/tacionjs
 *
 * Date: Thursday, July 6th 2012
 */

/*global yepnope, Pusher */
(function(global, dom, loader, Pusher, mobile, $){

	"use strict";

	/**
	* A map of jQuery elements that are used globally
	* @type {Object}
	*/
	var elements = {
		window: $(global)
	};

	/**
	* A map of properties used to globally keep track of presentation state
	* @type {Object}
	*/
	var presentation = {
		assets: { },
		slide: 0,
		step: 0
	};

	/**
	* A map of objects used in the management and control of the pusher
	* web-socket channel
	* @type {Object}
	*/
	var sync = {
		role: 'passenger',
		switches: $(),
		channels: {}
	};

	/**
	* Starts a presentation by loading its manifest and then
	* calling the init function when the manifest is done loading.
	* @param {String} folder The folder that manifest.json lives in
	*/
	function start(folder) {

		// start a job to wait for document ready
		var documentReady = $.Deferred();

		// cache DOM elements once the document is ready
		elements.document = $(documentReady.resolve);
		documentReady.then(function(){
			spinner('loading presentation');
			elements.body = $(dom.body);
			elements.html = elements.body.closest('html').andSelf();			
		});

		// load a definition file for the presentation
		var manifestLoaded = loadFile('manifest.json', folder);
		$.when(manifestLoaded, documentReady).then(function(args){
			// and, finally, start this puppy
			init(args.shift());
		});

	}

	/**
	* Initializes the internal framework state.
	* @param {Object} manifest The manifest file describing the presentation
	*/
	function init(manifest) {

		// set slide parameters
		presentation.slides     = manifest.slides;
		presentation.slideCount = manifest.slides.length;

		// try to connect the syncing channel.
		// no need to block, we can let this load in parallel
		openSocket(manifest);

		// set a slide template (if defined), then bootstrap the page
		if (manifest.template) {
			loadFile(manifest.template)
				.then(setTemplate)
				.then(bootstrap);
		} else {
			setTemplate('<div data-role="page">{{content}}</div>');
			bootstrap();
		}
	}

	/**
	* Attempts to connect to the pusher real-time service. By default,
	* the method will put you in passenger mode. However, if a server is
	* defined in the manifest, and you are able to connect to it, then
	* it will put you in driver mode
	* @param {Object} manifest The configuration object. Relevant properties
	*                          are the 'pusher' and 'server' values.
	*/
	function openSocket(manifest) {
		// pessimistically disable syncing mode and all sync toggles
		setSyncing(false, false);

		// now check to see if the user would like to enable syncing mode
		if (manifest.api_key) {
			
			// if the user is not the driver, we can use this function
			// to put the driver in syncing passenger mode
			var syncingPassengerMode = function(){ 
				sync.socket = new Pusher(manifest.api_key, { encrypted: true });
				addSocketListener('connection', 'state_change', onConnectionChange);
				passengerMode();
			};
			
			// if the user is the driver, we can use this function
			// to put the driver in syncing driver mode
			var syncingDriverMode = function() {
				sync.server = manifest.server;
				setSyncing(true, true);
				driverMode();
			};
			
			// only enable driver mode if a server is defined, exists, 
			// and responds with a matching API key!
			if (manifest.server) {
				$.getJSON(manifest.server).then(function(data){
					if (data && data.api_key === manifest.api_key) {
						syncingDriverMode();
					} else {
						syncingPassengerMode();
					}
				}).fail(syncingPassengerMode);
			} else {
				syncingPassengerMode();
			}
		
		// if no pusher API key is provided, non-syncing passenger mode
		} else {
			passengerMode();
		}
	}

	/**
	* Handler that is called whenever the pusher socket state changes
	* @param {Object} state An object that describes the state of the socket
	*/
	function onConnectionChange(state) {
		var errorMessages = {
			failed: 'Syncing support unavailable for this device.',
			disconnected: 'Connection lost! Will try again momentarily...'
		};
		// if the state change has caused an error, display a message
		// and disable syncing across the presentation
		if (state.current in errorMessages) {
			setSyncing(false, false);
			alert(errorMessages[event.current]);

		// otherwise, re-enable syncing and hide any alerts.
		} else if (state.current === 'connected') {
			setSyncing(true, true);
			alert(false);
		}
	}

	/**
	* Depending on the sync role, this method determines whether or not
	* events are sent or received across the sync channel
	* @param enabled Whether or not events will be sent or received
	* @param switchable Whether or not the user can switch between manual and sync mode
	*/
	function setSyncing(enabled, switchable) {

		// set the sync theme based on the sync state
		if (sync.enabled !== enabled) {
			sync.enabled = enabled;
			toggleSyncTheme(enabled);
			if (sync.role === 'passenger') {
				toggleController(!enabled);
			}
		}

		// set whether or not the user can switch between sync and manual mode
		if (sync.switchable !== switchable && switchable !== undefined) {
			sync.switchable = switchable;
		}

		// enable or disable the sync switches
		sync.switches.slider(sync.switchable ? 'enable' : 'disable');

		// finally, set the sync switch values for all the slides
		var value = enabled ? 'syncing' : 'off';
		sync.switches.val(value).slider('refresh');

	}

	/**
	* Toggles the manual slide controller on and off. The manual slide controller
	* is what allows the user to change slides by using input.
	* @param {Boolean} on True to turn the controller on, false to shut it off.
	*/
	function toggleController(on) {
		var manual = !!on;
		// check to prevent multiple additions of event listeners...
		if (sync.manual !== manual) {
			var method = (sync.manual = manual) ? 'on' : 'off';
			var events = 'swipeleft swiperight keyup';
			// add or remove event listeners for the controller
			elements.document[method](events, controller);
		}
	}

	/**
	* Interprets user triggered events and applies a corresponding action
	* @param {Event} event A user triggered touch or keyboard event
	*/
	function controller(event) {
		// ignore events on elements that have focus!
		var ignored = '.ui-focus,.ui-focus *';
		if (!$(event.target).is(ignored)) {
			// swiping to the left moves to the next slide
			if (event.type === 'swipeleft') { next(); }
			// swiping to the right moves to the previous slide
			else if (event.type === 'swiperight') { prev(); }
			// the following keys also have actions associated with them
			else {
				switch(event.which) {
					case 37: // left arrow
						prev(); break;
					case 39: // right arrow
					case 32: // space bar
						next(); break;
				}
			}
		}
	}

	/**
	* Transitions presentation to the next step, or slide
	*/
	function next() {

		var slide = presentation.slide;
		var step = presentation.step;
		var nextSlide = slide + 1;
		var nextStep = step + 1;

		getSlide(slide).then(function(page){

			var remainingSteps = page.data('steps').not('.active');

			// if there are still steps to transition to, then move to the next step
			if (remainingSteps.size() > 0) {
				change(nextStep, slide);

			// otherwise, move to the first step of the next slide
			} else if (nextSlide < presentation.slideCount) {
				change(0, nextSlide);
			}

		});

	}

	/**
	* Transitions presentation to the previous step, or slide
	*/
	function prev() {

		var slide     = presentation.slide;
		var step      = presentation.step;
		var prevSlide = slide - 1;
		var prevStep  = step - 1;

		// if the last step is still positive, then we are on the same slide
		if (prevStep >= 0) {
			change(prevStep, slide);

		// otherwise, we have to transition to the last slide
		} else if (prevSlide >= 0) {
			change(0, prevSlide);
		}

	}
	
	function applySyncTheme(slide, on) {
        var alternators = slide.data('alternators');
		var theme = 'ui-bar-' + alternators.data('sync-theme');
		alternators.toggleClass(theme, on);
	}

	/**
	* Alternates the theme of sync elements (like the header, if defined).
	* Used to show that sync mode is on.
	*/
	function toggleSyncTheme(on) {
		$.each(presentation.slides, function(index, gotSlide){
			if (gotSlide.then) {
				gotSlide.then(function(slide){
				    applySyncTheme(slide, on);
				});
			}
		});
	}

	/**
	* Puts the user in passenger mode. This means that changes to the
	* presentation's state are driven by the sync channel. If the user
	* is in manual mode, then sync events will be ignored and the user
	* can control his/her own presentation
	*/
	function passengerMode() {
		elements.body.addClass(sync.role = 'passenger');
		elements.body.removeClass('driver');
		addSocketListener('sync', 'state', syncState);
		toggleController(!!sync.manual);
	}

	/**
	* Puts the user in driver mode. This means that changes to the
	* presentation state are done manually, and all changes are
	* sent to the sync channel for sharing with all passengers
	*/
	function driverMode() {
		elements.body.addClass(sync.role = 'driver');
		elements.body.removeClass('passenger');
		toggleController(true);
	}

	/**
	* Binds an event listener to a Pusher web-socket channel
	* @param {String} channelName The channel to bind a listener to
	* @param {String} event The event to listen for
	* @param {Function} callback The handler for when the event is fired
	*/
	function addSocketListener(channelName, event, callback) {
		if (channelName && sync.socket) {
			var channel = getOrCreateChannel(channelName);
			if (event && callback) {
				channel.bind(event, callback);
			}
		}
	}

	/**
	* Removes an event listener from a Pusher web-socket channel
	* @param {String} channelName The channel to remove a listener from
	* @param {String} event The event to stop listening to
	* @param {Function} callback The handler to remove
	*/
	function removeSocketListener(channelName, event, callback) {
		if ((channelName in sync.channels) && sync.socket) {
			var channel = getOrCreateChannel(channelName);
			if (event && callback) {
				channel.unbind(event, callback);
			}
		}
	}

	/**
	* Fires an event (with optional data) against a web-socket channel. Only
	* drivers can use this method, as it sends messages to the server defined
	* in the manifest. If the server is not there, this method will fail
	* @param {String} channel The channel to fire the event on
	* @param {String} event The event to fire on the channel
	* @param {Object} data A map of data to send to the channel
	* @return {jQuery.Deferred} The AJAX request to the server
	*/
	function sendSocketData(channel, event, data) {
		return $.ajax({
			url: sync.server,
			type: 'POST',
			contentType: 'application/json',
			data: JSON.stringify({
				channel: channel,
				event: event,
				data: data
			})
		});
	}

	/**
	* Attempts to get or create a channel by name
	* @param {String} name The name of the channel to fetch
	* @return {Pusher.Channel} The fetched channel
	*/
	function getOrCreateChannel(name) {
		if (name === 'connection') {
			return sync.socket.connection;
		} else if (name in sync.channels) {
			return sync.channels[name];
		} else {
			return sync.channels[name] = sync.socket.subscribe(name);
		}
	}

	/**
	* Loads a generic file from the presentation's folder
	* @param {String} path The relative file path to load
	* @param {String} folder The folder to set for relative paths
	* @return {jQuery.Deferred} The deferred object for the request
	*/
	function loadFile(path, folder) {
		return $.get(absolutePath(path, folder));
	}

	/**
	* Gets an absolute path for a presentation relative file
	* @param {String} path The relative file path
	* @param {String} folder The folder to set for relative paths (optional)
	* @return {String} An absolute path to the relative file
	*/
	function absolutePath(path, folder) {
		if (folder) { presentation.rootFolder = folder; }
		return presentation.rootFolder+'/'+path;
	}

	/**
	* Setter for the presentation's slide template
	* @param {String} html The slide template markup
	*/
	function setTemplate(html) {
		presentation.template = html;
	}

	/**
	* Bootstraps the tacion client over jQuery mobile's default
	* handlers
	*/
	function bootstrap() {
		// figure out what slide we're on (from the URL)
		var current = urlState(location);
		// intercept jQuery mobile's default change handler
		elements.document.on('pagebeforechange', onChange);
		// finally, force the correct slide to load
		change(current.step, current.slide);
	}

	/**
	* Parses the a URL fragment for state information
	* @param {String} href An optional pass-in to parse, defaults to the current URL
	* @return {Object} A state map from the URL
	*/
	function urlState(href) {
		var url = href ? mobile.path.parseUrl(href) : global.location;
		var hash = url.hash.split('#').pop();
		var pairs = hash.split('&');
		var args = { slide: 0, step: 0 };
		$.each(pairs, function(i, pair){
			pair = pair.split('=');
			args[pair[0]] = parseInt(pair[1], 10);
		});
		return args;
	}

	/**
	* Shows or hides a loading message in the UI
	* @param {String|Boolean} msgText The text to show in the loading message, or false to hide it
	*/
	function spinner(msgText) {
		if (msgText) {
			mobile.showPageLoadingMsg('a', msgText, true);
		} else {
			mobile.hidePageLoadingMsg();
		}
	}

	/**
	* Changes the slide (or step) by updating the URL hash
	* @param {Number} step The step to change to
	* @param {Number} slide The slide to change to
	* @param {Object} options Any options to override for the pending transition
	*/
	function change(step, slide, options) {
		step = unsigned(step) ? step : 0;
		slide = unsigned(slide) ? slide : 0;
		mobile.changePage('#slide='+slide+'&step='+step, options);
	}

	/**
	* Checks if a value is numeric, and greater or equal to 0
	* @param {*} i The value to check
	* @return {Boolean} true if the value is unsigned, false otherwise
	*/
	function unsigned(i) {
		return $.type(i) === 'number' && i >= 0;
	}

	/**
	* Called whenever the 'pagebeforeload' event is fired. This method
	* subverts jQuery mobile's built in controller so that we may load
	* in our own content
	* @param {Event} event The 'pagebeforeload' event object
	* @param {Object} data A configuration object for the event
	*/
	function onChange(event, data) {
		// figure out where jQuery mobile wants us to go...
		var location = data.toPage;
		
		// tacion will handle any page changes to a new URL (a string)
		if ($.type(location) === 'string') {
			
			// extract the new state from the URL
			var current = urlState(location);
			
			// use the new slide state to load it's content 
			update(current.slide, current.step, data);
			
			// finally, prevent jQuery mobile from handling this request.
			event.preventDefault();
		}
	}

	/**
	* Creates an object used for transitioning between slides and steps
	* @param {Number} slide The slide to show
	* @param {Number} step The step in the slide to transition to
	* @param {Object} data A default map of transition data	
	* @return {Object} The final map of transition data
	*/
	function transitionOptions(slide, step, data) {
		
		// create a list of required options
		var required = {
			dataUrl: data.toPage,			
			allowSamePageTransition: true,
			reverse: slide < presentation.slide,
			isNewSlide: presentation.slide !== slide
		};

		// create a list of optional options
		var optional = {
			transition: required.isNewSlide ? 'fade' : 'none'
		};
		
		// generate the transition object
		return $.extend(optional, data.options || {}, required);
		
	}

	/**
	* Updates the presentation to display the requested slide and step
	* @param {Number} slide The slide to show
	* @param {Number} step The step in the slide to transition to
	* @param {Object} data A map of transition data
	*/
	function update(slide, step, data) {
		spinner('loading slide');

		// create some jQuery mobile "transition" options
		var options = transitionOptions(slide, step, data);

		// get the requested slide page (the jQuery object!)
		getSlide(slide).then(function(page){
			// reset scroll before switching to new slides
			if (options.isNewSlide) { scrollTo(0, 0); }

			// show the current slide and move to the correct step
			mobile.changePage(page, options);
			gotoStep(step, page);

			// finally, mark the internal state as changed
			trigger('update', {
				page: page,
				slide: presentation.slide = slide,
				step: presentation.step = step
			});
		});
		
		// ensure that any passengers are kept in sync!
		if (sync.role === 'driver') {
			syncState({ slide: slide, step: step });
		}
	}

	/**
	* Gets a slide from memory or from the server. Returns a job that can be
	* used to extract the slide page element
	* @param {Number} slide The slide index to retrieve
	* @return {jQuery.Deferred} An async job that can be used to fetch the slide page
	*/
	function getSlide(slide) {
		var loader = presentation.slides ? presentation.slides[slide] : undefined;

		// if the slide index does not exist, error out
		if (loader === undefined) {
			return $.Deferred().reject(slide);
		} else {
			// if the slide index is a path, we should convert it
			// to an async loader for the slide
			if (!loader.then) {
				loader = presentation.slides[slide] = loadSlide(slide, loader);
			}
			// finally, return the loader interface
			return loader.promise();
		}
	}

	/**
	* Loads a slide from the server and returns a job that can be used to
	* access the slide page
	* @param {Number} slide The slide index to load
	* @param {String} path The path to the slide content file
	* @return {jQuery.Deferred} An async job that can be used to fetch the slide page
	*/
	function loadSlide(slide, path) {
		var afterRender = $.Deferred();
		loadFile(path).then(function(html) {
			renderSlide(slide, html).then(afterRender.resolve);
		});
		return afterRender.promise();
	}

	/**
	* Takes raw html content for a slide, and returns a job that can be used to access
	* the final rendered slide page	
	* @param {Number} slide The slide index to render
	* @param {String} html The raw html of the slide content
	* @return {jQuery.Deferred} An async job that can be used to fetch the slide page
	*/
	function renderSlide(slide, html) {

		// used to track the render job
		var job = $.Deferred();

		// interpolates the slide content into the template
		var slide = applySlideTemplate(slide, html);

		// parse the slide content for shared elements
		var content     = slide.find('[data-role=content]');
		var alert       = slide.find('.alert');
		var assets      = slide.find('link[href]').remove();
		var steps       = slide.find('[data-step]');
		var alternators = slide.find('[data-sync-theme]');
		var contentId   = content.attr('id');

		// the whole page might actually be a step
		// (if the content defines a page step)
		var pageStep = content.data('page-step');
		if (pageStep) {
			steps.push(slide.attr('data-step', pageStep).get(0));
		}

		// bind slide data to the slide, and add the slide to the page
		slide.attr('id', contentId + '-page').data({
			steps: steps,
			alternators: alternators,
			alert: alert
		}).appendTo(elements.body).page();

		// add any sync switches to the global list
		var syncSwitches = slide.find('.sync');
		if (syncSwitches.size()) {
			syncSwitches.each(addSyncSwitch).change(toggleSyncing);
		}
		
		// set the header style
		applySyncTheme(slide, sync.enabled);

		// bind click listener to alerts
		if (alert.size()) {
			alert.on('click', function(){
				alert.removeClass('active');
			});
		}

		// download any declared assets in the slide content
		var urls = $.makeArray(assets.map(toAssetUrl));
		var done = function(){ job.resolve(slide); };
		if (urls.length) {
			loader({
				load: urls,
				complete: done
			});
		} else {
			done();
		}

		return job.promise();

	}

	/**
	* Maps asset elements to their absolute asset URL.
	* Also prunes out previously loaded assets
	* @param {Number} i The asset index to prune out
	* @param {Element} asset The asset element to map
	* @return {String|undefined} An asset URL, or undefined if the asset is to be pruned
	*/
	function toAssetUrl(i, asset) {
		var path = $(asset).attr('href');
		if (path in presentation.assets) {
			return undefined;
		} else {
			presentation.assets[path] = true;
			return absolutePath(path);
		}
	}

	/**
	* Adds a sync switch to the list of global sync switches
	* @param {Integer} i The index of the added switch
	* @param {Element} syncSwitch The DOM element to be added to the list
	*/
	function addSyncSwitch(i, syncSwitch) {
		sync.switches.push(syncSwitch);
		setSyncing(sync.enabled);
	}

	/**
	* Globally toggles syncing for the presentation
	* @param {Event} event The change event on a sync switch
	*/
	function toggleSyncing(event) {
		var syncing = $(event.target).val();
		setSyncing(syncing === 'syncing');
		elements.body.focus();
	}

	/**
	* Interpolates slide content into a template. Also fills in declared constants
	* @param {Number} slide The slide index to retrieve
	* @param content The content to interpolate
	* @return {jQuery} The rendered jQuery element
	*/
	function applySlideTemplate(slide, content) {
		var pattern = /\{\{([a-z]+)\}\}/g;
		var template = presentation.template;

		// loop over matched keys and interpolate presentation constants
		// as well as the content for the current slide
		var html = template.replace(pattern, function(match, key){
			if (key === 'content') {
				return content;
			} else if (key === 'index') {
				return slide + 1;
			} else if (key === 'count') {
				return presentation.slideCount;
			}
		});
		return $(html);
	}

	/**
	* Transitions to a step in a given slide
	* @param {Number} step The step to transition to
	* @param {jQuery} page The parent slide page
	*/
	function gotoStep(step, page) {
		var target, padding = 100;
		// iterate over every step
		page.data('steps').each(function(){
			var element = $(this);
			var active = element.data('step') <= step;
			// determine if the step is active or not
			if (active) {
				// capture the *first* converted step to scroll to
				if (!element.hasClass('active') && !target) {
					target = element;
				}
				element.addClass('active');
			} else {
				element.removeClass('active');
			}
		});

		// check to scroll to next step
		if (target && !elementVisible(target, padding)) {
			scrollTo(target.offset().top-padding);
		}
	}

	/**
	* Determines if an element is on screen
	* @param {jQuery} target The element to check
	* @param {Number} padding The padding off of the bottom of the window to count out
	* @return {Boolean} True if the element is on screen, otherwise false.
	*/
	function elementVisible(target, padding) {
		var el = target.get(0);
		var top = el.offsetTop;
		var left = el.offsetLeft;
		var width = el.offsetWidth;
		var height = el.offsetHeight;

		while(el.offsetParent) {
			el = el.offsetParent;
			top += el.offsetTop;
			left += el.offsetLeft;
		}

		return (
			top >= global.pageYOffset &&
				left >= global.pageXOffset &&
				(top + height) <= (global.pageYOffset + global.innerHeight - (padding||0)) &&
				(left + width) <= (global.pageXOffset + global.innerWidth)
			);
	}

	/**
	* Scrolls the screen to a Y position on the screen
	* @param {Number} top The Y position to scroll to
	* @param {Number} time The time to take when scrolling (default 500ms)
	*/
	function scrollTo(top, time) {
		var scrollTop = Math.max(top, 0);
		var duration = time !== undefined ? time : 500;
		var step = function(){
			elements.window.trigger('resize');
		};
		elements.html.animate({
			scrollTop: scrollTop
		}, {
			duration: duration,
			step: step
		});
	}

	/**
	* Syncs the state between a driver and passengers.
	* Calling this method as a driver sends the state to passengers.
	* Calling as a passenger will set the current state to the provided values.
	* @param {Object} state The state to either send or apply (depending on role)
	*/
	function syncState(state) {
		// only sync state if syncing is enabled!
		if (sync.enabled) {
			// passengers will apply a new state
			if (sync.role === 'passenger') {
				change(state.step, state.slide);
			// drivers send their state over the socket
			} else {
				sendSocketData('sync', 'state', state);
			}
		}
	}

	/**
	* Triggers a global event for the API
	* @param {String} event The event name
	* @param {Object} data Data to pass to the event listeners
	*/
	function trigger(event, data) {
		elements.window.trigger(namespaceEvent(event), data);
	}

	/**
	* Binds an event handler to an API event
	* @param {String} event The event to bind to
	* @param {Function} callback The event listener add
	*/
	function on(event, callback) {
		elements.window.on(namespaceEvent(event), callback);
	}

	/**
	* Removes an event handler from the API
	* @param {String} event The event to unbind
	* @param {Function} callback The event listener to remove
	*/
	function off(event, callback) {
		elements.window.off(namespaceEvent(event), callback);
	}

	/**
	* Namespaces events so that they do not collide with real DOM events
	* @param {String} event The event to namespace
	* @return {String} The namespaced event
	*/
	function namespaceEvent(event) {
		return 'tacion:' + event;
	}

	/**
	* Displays a message to the user in an alert box. If an alert box
	* is defined in the slide markup, then that will be used over the
	* native implementation
	* @param {String|Boolean} message The message to alert to the user
	*/
	function alert(message) {

		// hide any loader messages
		spinner(false);

		// use native alerts if no alert is found in the slide markup
		var alertFallback = function(){
			if ($.type(message) === 'string') {
				global.alert(message);
			}
		};

		getSlide(presentation.slide).then(function(page){
			// check for an alert element in the slide markup
			var alert = page.data('alert');
			if (alert) {
				// if the message is a string, we show the alert
				if ($.type(message) === 'string') {
					alert.children('.message').text(message);
					alert.addClass('active');
					scrollTo(0);
				// otherwise we hide the alert box
				} else {
					alert.removeClass('active');
				}
			} else { alertFallback(); }
		}).fail(alertFallback);
	}

	// Expose the public API
	global.tacion = {  // i.e. window.tacion
		alert:   alert,
		change:  change,
		next:    next,
		off:     off,
		on:      on,
		prev:    prev,
		spinner: spinner,
		start:   start
	};

})(window, document, yepnope, Pusher, jQuery.mobile, jQuery);

/**
 * *** NOTE: THIS IS A HACK ***
 * I was forced to hot-patch jQuery mobile to fix it's
 * scroll preservation support. jQuery mobile is
 * supposed to keep track of your last scroll offset
 * before a transition, and the restore it after the
 * transition. Unfortunately, when transitioning
 * between steps on a slide, the scroll offset is lost.
 * This patch simply forces the active history object
 * to always have a "lastScroll" property, essentially
 * remedying the situation. Alas, I have no idea if this
 * change will break other components.
 */
(function(history, global){

	"use strict";

	var oldGetActive = history.getActive;
	var frame = $(global);

	history.getActive = function(){
		var active = oldGetActive() || {};
		if (active.lastScroll === undefined) {
			active.lastScroll = frame.scrollTop();
		}
		return active;
	};

})(jQuery.mobile.urlHistory, window);

