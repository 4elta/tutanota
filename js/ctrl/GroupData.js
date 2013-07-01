"use strict";

goog.provide('tutao.tutanota.ctrl.GroupData');

/**
 * @param {string} encryptedName
 *            the name of the group encrypted with the group's session key.
 * @param {string} mailAddr
 *            the mail address of the group.
 * @param {Object} pubKey
 *            the public key of the group.
 * @param {string} symEncPrivKey
 *            the private key of the group encrypted with the symmetric group key.
 * @param {string} pubEncGKey
 *            the symmetric group key encrypted with the public key of the admin group, used in
 *            GroupAdminship.
 * @param {string} symEncGKey
 *            the symmetric group key encrypted with the symmetric user key, used in
 *            GroupMembership.
 * @param {string} symEncSessionKey
 *            the symmetric session key of the group element encrypted wih the symmetric group
 *            key.
 * @param {Object} groupKey
 *            the group key.
 * @param {Object} sessionKey The session key.
 */
tutao.tutanota.ctrl.GroupData = function(encryptedName, mailAddr, pubKey, symEncPrivKey, pubEncGKey, symEncGKey, symEncSessionKey, groupKey, sessionKey) {
	this._encryptedName = encryptedName;
	this._mailAddr = mailAddr;
	this._pubKey = pubKey;
	this._symEncPrivKey = symEncPrivKey;
	this._pubEncGKey = pubEncGKey;
	this._symEncGKey = symEncGKey;
	this._symEncSessionKey = symEncSessionKey;
	this._groupKey = groupKey;
	this._sessionKey = sessionKey;
};

/**
 * @param {string} name
 *            the name of the group.
 * @param {string} mailAddr
 * @param {Object} userKey
 *            the symmetric user key used for encrypting the symmetric group key for group
 *            memberships.
 * @param {Object} pubAdminKey
 *            the public key of the admin group, used to encrypte the symmetric group key for
 *            group adminships.
 * @param {function(?tutao.tutanota.ctrl.GroupData, exception=)} callback Called when finished. Receives the group data object.
 */
tutao.tutanota.ctrl.GroupData.generateGroupKeys = function(name, mailAddr, userKey, pubAdminKey, callback) {
	var symKey = tutao.locator.aesCrypter.generateRandomKey();
	tutao.locator.rsaCrypter.generateKeyPair(function(keyPair, exception) {
		if (exception) {
			callback(null, exception);
			return;
		}
		var sessionKey = tutao.locator.aesCrypter.generateRandomKey();

		var encryptedName = tutao.locator.aesCrypter.encryptUtf8(sessionKey, name, true);
		var pubKey = tutao.locator.rsaCrypter.keyToHex(keyPair.publicKey);
		var symEncPrivKey = tutao.locator.aesCrypter.encryptPrivateRsaKey(symKey, tutao.locator.rsaCrypter.keyToHex(keyPair.privateKey));
		var pubEncGKey = null;
		var symEncGKey = null;
		if (userKey != null) {
			symEncGKey = tutao.locator.aesCrypter.encryptKey(userKey, symKey);
		}
		var symEncSessionKey = tutao.locator.aesCrypter.encryptKey(symKey, sessionKey);
		if (pubAdminKey != null) {
			tutao.locator.rsaCrypter.encryptAesKey(pubAdminKey, tutao.locator.aesCrypter.keyToHex(symKey), function(pubEncGKey, exception) {
				if (exception) {
					callback(null, exception);
					return;
				}
				callback(new tutao.tutanota.ctrl.GroupData(encryptedName, mailAddr, pubKey, symEncPrivKey, pubEncGKey, symEncGKey, symEncSessionKey, symKey, sessionKey));
			});
		} else {
			callback(new tutao.tutanota.ctrl.GroupData(encryptedName, mailAddr, pubKey, symEncPrivKey, pubEncGKey, symEncGKey, symEncSessionKey, symKey, sessionKey));
		}
	});
};

tutao.tutanota.ctrl.GroupData.prototype.getEncryptedName = function() {
	return this._encryptedName;
};

tutao.tutanota.ctrl.GroupData.prototype.getMailAddr = function() {
	return this._mailAddr;
};

tutao.tutanota.ctrl.GroupData.prototype.getPubKey = function() {
	return this._pubKey;
};

tutao.tutanota.ctrl.GroupData.prototype.getSymEncPrivKey = function() {
	return this._symEncPrivKey;
};

tutao.tutanota.ctrl.GroupData.prototype.getPubEncGKey = function() {
	return this._pubEncGKey;
};

tutao.tutanota.ctrl.GroupData.prototype.getSymEncGKey = function() {
	return this._symEncGKey;
};

/**
 * used if the symmetric user key is only available after the this object has already been
 * created
 * @params {string} symEncGKey
 */
tutao.tutanota.ctrl.GroupData.prototype.setSymEncGKey = function(symEncGKey) {
	this._symEncGKey = symEncGKey;
};

tutao.tutanota.ctrl.GroupData.prototype.getSymEncSessionKey = function() {
	return this._symEncSessionKey;
};

tutao.tutanota.ctrl.GroupData.prototype.getSymGroupKey = function() {
	return this._groupKey;
};

tutao.tutanota.ctrl.GroupData.prototype.getSessionKey = function() {
	return this._sessionKey;
};
