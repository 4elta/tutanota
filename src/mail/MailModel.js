//@flow
import m from "mithril"
import stream from "mithril/stream/stream.js"
import {containsEventOfType, neverNull, noOp} from "../api/common/utils/Utils"
import {createMoveMailData} from "../api/entities/tutanota/MoveMailData"
import {load, loadAll, serviceRequestVoid} from "../api/main/Entity"
import {TutanotaService} from "../api/entities/tutanota/Services"
import {elementIdPart, getListId, HttpMethod, isSameId, listIdPart} from "../api/common/EntityFunctions"
import {LockedError, NotFoundError, PreconditionFailedError} from "../api/common/error/RestError"
import {Dialog} from "../gui/base/Dialog"
import {logins} from "../api/main/LoginController"
import {createDeleteMailData} from "../api/entities/tutanota/DeleteMailData"
import type {MailBox} from "../api/entities/tutanota/MailBox"
import {MailBoxTypeRef} from "../api/entities/tutanota/MailBox"
import type {MailboxGroupRoot} from "../api/entities/tutanota/MailboxGroupRoot"
import {MailboxGroupRootTypeRef} from "../api/entities/tutanota/MailboxGroupRoot"
import type {GroupInfo} from "../api/entities/sys/GroupInfo"
import {GroupInfoTypeRef} from "../api/entities/sys/GroupInfo"
import type {Group} from "../api/entities/sys/Group"
import {GroupTypeRef} from "../api/entities/sys/Group"
import type {MailFolder} from "../api/entities/tutanota/MailFolder"
import {MailFolderTypeRef} from "../api/entities/tutanota/MailFolder"
import {FeatureType, GroupType, MailFolderType, OperationType} from "../api/common/TutanotaConstants"
import {UserTypeRef} from "../api/entities/sys/User"
import type {Mail} from "../api/entities/tutanota/Mail"
import {MailTypeRef} from "../api/entities/tutanota/Mail"
import type {EntityUpdateData} from "../api/main/EventController"
import {EventController, isUpdateForTypeRef} from "../api/main/EventController"
import {lang} from "../misc/LanguageViewModel"
import {Notifications} from "../gui/Notifications"
import {ProgrammingError} from "../api/common/error/ProgrammingError"
import {findAndApplyMatchingRule} from "./InboxRuleHandler"
import {getFromMap} from "../api/common/utils/MapUtils"
import type {WebsocketCounterData} from "../api/entities/sys/WebsocketCounterData"
import {SysService} from "../api/entities/sys/Services"
import {createPublicKeyData} from "../api/entities/sys/PublicKeyData"
import type {PublicKeyReturn} from "../api/entities/sys/PublicKeyReturn"
import {PublicKeyReturnTypeRef} from "../api/entities/sys/PublicKeyReturn"
import type {WorkerClient} from "../api/main/WorkerClient"

export type MailboxDetail = {
	mailbox: MailBox,
	folders: MailFolder[],
	mailGroupInfo: GroupInfo,
	mailGroup: Group,
	mailboxGroupRoot: MailboxGroupRoot,
}

export type MailboxCounters = {
	// mail group
	[Id]: {
		// mailListId and counter
		[string]: number
	}
}

export class MailModel {
	/** Empty stream until init() is finished, exposed mostly for map()-ing, use getMailboxDetails to get a promise */
	mailboxDetails: Stream<MailboxDetail[]>
	mailboxCounters: Stream<MailboxCounters>
	_initialization: ?Promise<void>
	_notifications: Notifications
	_eventController: EventController
	_worker: WorkerClient

	constructor(notifications: Notifications, eventController: EventController, worker: WorkerClient) {
		this.mailboxDetails = stream()
		this.mailboxCounters = stream({})
		this._initialization = null
		this._notifications = notifications
		this._eventController = eventController
		this._worker = worker
	}

	init(): Promise<void> {
		if (this._initialization) {
			return this._initialization
		}
		this._eventController.addEntityListener((updates) => this.entityEventsReceived(updates))

		this._eventController.countersStream().map((update) => {
			this._mailboxCountersUpdates(update)
		})
		return this._init()
	}

	_init(): Promise<void> {
		let mailGroupMemberships = logins.getUserController().getMailGroupMemberships()
		this._initialization = Promise.all(mailGroupMemberships.map(mailGroupMembership => {
				return Promise.all([
					load(MailboxGroupRootTypeRef, mailGroupMembership.group),
					load(GroupInfoTypeRef, mailGroupMembership.groupInfo),
					load(GroupTypeRef, mailGroupMembership.group)
				]).spread((mailboxGroupRoot, mailGroupInfo, mailGroup) => {
					return load(MailBoxTypeRef, mailboxGroupRoot.mailbox).then((mailbox) => {
						return this._loadFolders(neverNull(mailbox.systemFolders).folders, true)
						           .then((folders) => {
							           return {
								           mailbox,
								           folders,
								           mailGroupInfo,
								           mailGroup,
								           mailboxGroupRoot
							           }
						           })
					})
				})
			})
		).then(details => {
			this.mailboxDetails(details)
		}).return()
		return this._initialization
	}

	_loadFolders(folderListId: Id, loadSubFolders: boolean): Promise<MailFolder[]> {
		return loadAll(MailFolderTypeRef, folderListId).then(folders => {
			if (loadSubFolders) {
				return Promise.map(folders, folder => this._loadFolders(folder.subFolders, false)).then(subfolders => {
					return folders.concat(...subfolders)
				})
			} else {
				return folders
			}
		}).then(folders => {
			return folders.filter(f => {
				if ((f.folderType === MailFolderType.SPAM || f.folderType === MailFolderType.ARCHIVE)
					&& !logins.isInternalUserLoggedIn()) {
					return false
				} else if (logins.isEnabled(FeatureType.InternalCommunication)
					&& f.folderType === MailFolderType.SPAM) {
					return false
				} else {
					return true
				}
			})
		})
	}

	getMailboxDetails(): Promise<Array<MailboxDetail>> {
		return this.init().then(() => {
			return this.mailboxDetails()
		})
	}

	getMailboxDetailsForMail(mail: Mail): Promise<MailboxDetail> {
		return this.getMailboxDetailsForMailListId(mail._id[0])
	}

	getMailboxDetailsForMailListId(mailListId: Id): Promise<MailboxDetail> {
		return this.getMailboxDetails().then(mailboxDetails =>
			neverNull(mailboxDetails.find((md) => md.folders.find(f => f.mails === mailListId) != null)))
	}

	getMailboxDetailsForMailGroup(mailGroupId: Id): Promise<MailboxDetail> {
		return this.getMailboxDetails().then(mailboxDetails =>
			neverNull(mailboxDetails.find((md) => mailGroupId === md.mailGroup._id)))
	}

	getUserMailboxDetails(): Promise<MailboxDetail> {
		let userMailGroupMembership = logins.getUserController().getUserMailGroupMembership()
		return this.getMailboxDetails().then(mailboxDetails =>
			neverNull(mailboxDetails.find((md) => md.mailGroup._id === userMailGroupMembership.group)))
	}

	getMailboxFolders(mail: Mail): Promise<MailFolder[]> {
		return this.getMailboxDetailsForMail(mail).then(md => md.folders)
	}

	getMailFolder(mailListId: Id): ?MailFolder {
		const mailboxDetails = this.mailboxDetails() || []
		for (let e of mailboxDetails) {
			for (let f of e.folders) {
				if (f.mails === mailListId) {
					return f
				}
			}
		}
		return null
	}

	moveMails(mails: Mail[], target: MailFolder): Promise<void> {
		let moveMails = mails.filter(m => m._id[0] !== target.mails && target._ownerGroup === m._ownerGroup) // prevent moving mails between mail boxes.
		if (moveMails.length > 0) {
			let moveMailData = createMoveMailData()
			moveMailData.targetFolder = target._id
			moveMailData.mails.push(...mails.map(m => m._id))
			return serviceRequestVoid(TutanotaService.MoveMailService, HttpMethod.POST, moveMailData)
				.catch(LockedError, e => Dialog.error("operationStillActive_msg"))
				.catch(PreconditionFailedError, e => Dialog.error("operationStillActive_msg"))
		}
		return Promise.resolve()
	}

	/**
	 * Finally deletes the given mails if they are already in the trash or spam folders,
	 * otherwise moves them to the trash folder.
	 * A deletion confirmation must have been show before.
	 */
	deleteMails(mails: Mail[]): Promise<void> {
		const moveMap: Map<IdTuple, Mail[]> = new Map()
		let mailBuckets = mails.reduce((buckets, mail) => {
			const folder = this.getMailFolder(mail._id[0])
			if (!folder) {
				throw new ProgrammingError("tried to delete mail without folder")
			} else if (this.isFinalDelete(folder)) {
				buckets.trash.push(mail)
			} else {
				getFromMap(buckets.move, folder._id, () => []).push(mail)
			}
			return buckets
		}, {trash: [], move: moveMap})

		let promises = []
		if (mailBuckets.trash.length > 0) {
			let deleteMailData = createDeleteMailData()
			const trashFolder = neverNull(this.getMailFolder(getListId(mailBuckets.trash[0])))
			deleteMailData.folder = trashFolder._id
			deleteMailData.mails.push(...mailBuckets.trash.map(m => m._id))
			promises.push(serviceRequestVoid(TutanotaService.MailService, HttpMethod.DELETE, deleteMailData)
				.catch(PreconditionFailedError, e => Dialog.error("operationStillActive_msg")))
		}
		if (mailBuckets.move.size > 0) {
			for (const [folderId, mails] of mailBuckets.move) {
				promises.push(this.getMailboxFolders(mails[0]).then(folders => this.moveMails(mails, this.getTrashFolder(folders))))
			}
		}
		return Promise.all(promises).return()
	}

	entityEventsReceived(updates: $ReadOnlyArray<EntityUpdateData>): void {
		// TODO: make all calls sequential in EntityRestCache instead?
		Promise.each(updates, update => {
			if (isUpdateForTypeRef(MailFolderTypeRef, update)) {
				return this._init().then(() => m.redraw())
			} else if (isUpdateForTypeRef(GroupInfoTypeRef, update)) {
				if (update.operation === OperationType.UPDATE) {
					return this._init().then(() => m.redraw())
				}
			} else if (isUpdateForTypeRef(UserTypeRef, update)) {
				if (update.operation === OperationType.UPDATE && isSameId(logins.getUserController().user._id, update.instanceId)) {
					return load(UserTypeRef, update.instanceId).then(updatedUser => {
						let newMemberships = updatedUser.memberships
						                                .filter(membership => membership.groupType === GroupType.Mail)
						return this.getMailboxDetails().then(mailboxDetails => {
							if (newMemberships.length !== mailboxDetails.length) {
								return this._init().then(() => m.redraw())
							}
						})
					})
				}
			} else if (isUpdateForTypeRef(MailTypeRef, update) && update.operation === OperationType.CREATE) {
				const folder = this.getMailFolder(update.instanceListId)
				if (folder && folder.folderType === MailFolderType.INBOX
					&& !containsEventOfType(updates, OperationType.DELETE, update.instanceId)) {
					// If we don't find another delete operation on this email in the batch, then it should be a create operation
					const mailId = [update.instanceListId, update.instanceId]
					return load(MailTypeRef, mailId)
						.then((mail) => this.getMailboxDetailsForMailListId(update.instanceListId)
						                    .then(mailboxDetail => findAndApplyMatchingRule(mailboxDetail, mail))
						                    .then((newId) => this._showNotification(newId || mailId)))
						.catch(noOp)
				}
			}
		})
	}

	_mailboxCountersUpdates(counters: WebsocketCounterData) {
		const normalized = this.mailboxCounters() || {}
		const group = normalized[counters.mailGroup] || {}
		counters.counterValues.forEach((value) => {
			group[value.mailListId] = Number(value.count) || 0
		})
		normalized[counters.mailGroup] = group
		this.mailboxCounters(normalized)
	}

	_showNotification(mailId: IdTuple) {
		this._notifications.showNotification(lang.get("newMails_msg"), {actions: []}, (e) => {
			m.route.set(`/mail/${listIdPart(mailId)}/${elementIdPart(mailId)}`)
			window.focus()
		})
	}

	getCounterValue(listId: Id): Promise<?number> {
		return this.getMailboxDetailsForMailListId(listId).then((mailboxDetails) => {
			const counters = this.mailboxCounters()
			const mailGroupCounter = counters[mailboxDetails.mailGroup._id]
			return mailGroupCounter && mailGroupCounter[listId]
		}).catch(() => null)
	}

	checkMailForPhishing(mail: Mail, links: Array<string>): Promise<boolean> {
		return this._worker.checkMailForPhishing(mail, links)
	}

	getTrashFolder(folders: MailFolder[]): MailFolder {
		return (folders.find(f => f.folderType === MailFolderType.TRASH): any)
	}

	isFinalDelete(folder: ?MailFolder): boolean {
		return folder != null && (folder.folderType === MailFolderType.TRASH || folder.folderType === MailFolderType.SPAM)
	}

	getRecipientKeyData(mailAddress: string): Promise<?PublicKeyReturn> {
		return this._worker.serviceRequest(
			SysService.PublicKeyService,
			HttpMethod.GET,
			createPublicKeyData({mailAddress}),
			PublicKeyReturnTypeRef
		).catch(NotFoundError, () => null)
	}
}

